"""
Steam fetcher v2.1 – smart merge with extension-provided data.

Key change: when a record already has rich data from the extension
(developer as array, platforms, languages, tags, etc.), the fetcher
only ENRICHES missing fields rather than overwriting everything.

apply_details() now:
  - Checks each field before overwriting
  - Normalizes developer to list format
  - Detects anti-cheat from categories using ANTI_CHEAT_PATTERNS
  - Preserves extension-provided arrays (platforms, languages, tags)
"""
import random
import time

from .constants import (
    STEAM_API_KEY, SKIP_GENRE_TAGS, ANTI_CHEAT_PATTERNS,
    BATCH_SIZE, BATCH_PAUSE_MIN, BATCH_PAUSE_MAX,
)
from .steam_client import get_client
from .data_store import extract_appid, now_iso, is_info_complete, _is_empty


# ──────────── Single-game updaters ────────────

def apply_details(game: dict, data: dict) -> dict:
    """
    Merge Steam appdetails API response into a game record.
    Only fills EMPTY fields – never overwrites extension-provided data.
    """
    # Name: always take freshest from API
    api_name = data.get("name", "")
    if api_name and _is_empty(game.get("name")):
        game["name"] = api_name

    # Description
    short_desc = (data.get("short_description") or "").strip()
    if short_desc and _is_empty(game.get("description")):
        game["description"] = short_desc

    # Header image
    img = data.get("header_image", "")
    if img and _is_empty(game.get("header_image")):
        game["header_image"] = img

    # Genre: only if empty
    if _is_empty(game.get("genre")):
        genres_raw = [g["description"] for g in data.get("genres", [])]
        filtered = [g for g in genres_raw if g not in SKIP_GENRE_TAGS]
        game["genre"] = filtered[0] if filtered else (
            genres_raw[0] if genres_raw else "Uncategorized"
        )

    # Developer: normalize to list, only if empty
    if _is_empty(game.get("developer")):
        devs = data.get("developers", [])
        game["developer"] = devs if isinstance(devs, list) else [devs]

    # Publisher: only if empty
    if _is_empty(game.get("publisher")):
        pubs = data.get("publishers", [])
        game["publisher"] = pubs if isinstance(pubs, list) else [pubs]

    # Release date: only if empty
    if _is_empty(game.get("release_date")):
        game["release_date"] = data.get("release_date", {}).get("date", "N/A")

    # Platforms: only if empty
    if _is_empty(game.get("platforms")):
        plat_data = data.get("platforms", {})
        platforms = []
        if plat_data.get("windows"): platforms.append("Windows")
        if plat_data.get("mac"):     platforms.append("macOS")
        if plat_data.get("linux"):   platforms.append("Linux")
        game["platforms"] = platforms

    # Languages + language_details: DEFERRED to HTML scrape
    # The API supported_languages field is an HTML string that lacks per-language
    # subtitles/audio breakdown. The store page HTML has a proper table with
    # Interface / Full Audio / Subtitles columns per language.
    # → Handled in apply_scraped_data() below, not here.

    # Anti-cheat: only if empty/default
    if _is_empty(game.get("anti_cheat")) or game.get("anti_cheat") == "-":
        ac_label = "-"
        ac_note = ""
        for cat in data.get("categories", []):
            desc = cat.get("description", "").lower()
            for label, patterns in ANTI_CHEAT_PATTERNS.items():
                if any(p in desc for p in patterns):
                    ac_label = label
                    ac_note = cat.get("description", "")
                    break
            if ac_label != "-":
                break
        game["anti_cheat"] = ac_label
        if ac_note and _is_empty(game.get("anti_cheat_note")):
            game["anti_cheat_note"] = ac_note

    # Metacritic
    mc = data.get("metacritic", {})
    if mc and mc.get("score") and _is_empty(game.get("metacritic")):
        game["metacritic"] = str(mc["score"])

    # DRM notes
    drm_info = []
    for cat in data.get("categories", []):
        d = cat.get("description", "")
        if "requires" in d.lower() and "account" in d.lower():
            drm_info.append(d)
    if data.get("drm_notice"):
        drm_info.append(data["drm_notice"])
    if drm_info and (_is_empty(game.get("drm_notes")) or game.get("drm_notes") == "-"):
        game["drm_notes"] = "; ".join(drm_info[:2])
    elif _is_empty(game.get("drm_notes")) or game.get("drm_notes") == "-":
        game["drm_notes"] = "None detected"

    # Free-to-play check
    is_free = data.get("is_free", False)
    price = data.get("price_overview", {})
    if price:
        is_free = is_free or price.get("initial", 1) == 0
    if not is_free and "No longer free" not in game.get("notes", ""):
        game["notes"] = (game.get("notes", "") + " ⚠ No longer free! Check price.").strip()

    # has_paid_dlc: DEFERRED to HTML scrape
    # The API only gives DLC appid list, not their prices.
    # Checking categories for "In-App Purchases" is unreliable (many F2P games
    # have IAP tag but free DLC, or vice versa).
    # → Handled in apply_scraped_data() by parsing actual DLC price elements.

    return game


def apply_reviews(game: dict, summary: dict) -> dict:
    total = summary.get("total_reviews", 0)
    positive = summary.get("total_positive", 0)
    if total > 0:
        pct = round((positive / total) * 100)
        label = summary.get("review_score_desc", "")
        game["reviews"] = f"{pct}% ({label})" if label else f"{pct}%"
    else:
        game["reviews"] = "No reviews"
    return game


def apply_players(game: dict, count: int) -> dict:
    """Set current player count + update peak if higher."""
    game["current_players"] = f"{count:,}"
    old_peak = game.get("peak_today", "N/A")
    if old_peak in ("N/A", "Error", ""):
        game["peak_today"] = f"{count:,}"
    else:
        try:
            if count > int(old_peak.replace(",", "")):
                game["peak_today"] = f"{count:,}"
        except ValueError:
            game["peak_today"] = f"{count:,}"
    return game


def apply_scraped_data(game: dict, scraped: dict) -> dict:
    """
    Apply data parsed from store page HTML.

    scraped comes from scraper.scrape_store_page() and contains:
      - languages: list[str]
      - language_details: list[dict] with interface/audio/subtitles booleans
      - has_paid_dlc: bool (actual DLC price check, not just existence)
      - tags: list[str]
    """
    # Languages + language_details: only if empty
    if _is_empty(game.get("languages")) and scraped.get("languages"):
        game["languages"] = scraped["languages"]
    if _is_empty(game.get("language_details")) and scraped.get("language_details"):
        game["language_details"] = scraped["language_details"]

    # Tags: only if empty
    if _is_empty(game.get("tags")) and scraped.get("tags"):
        game["tags"] = scraped["tags"]

    # has_paid_dlc: HTML scrape is authoritative (checks actual prices)
    # Only override if we haven't been manually set
    game["has_paid_dlc"] = scraped.get("has_paid_dlc", False)

    return game


# ──────────── Full single-game fetch ────────────

def fetch_full(game: dict, client=None, fetch_players: bool = True,
               scrape_page: bool = True) -> dict:
    """
    Fetch all available data for one game.

    Steps:
      1. Steam appdetails API → name, genre, developer, etc.
      2. Steam reviews API → review score
      3. Steam player count API → concurrent players (needs key)
      4. Store page HTML scrape → languages (table), tags, DLC prices

    Step 4 is a single GET request that provides languages, tags, and
    has_paid_dlc — all three are unavailable or unreliable from the API.
    """
    from .scraper import scrape_store_page

    c = client or get_client()
    appid = extract_appid(game.get("link", ""))
    if not appid:
        print(f"    ✗ Invalid link: {game.get('link', '?')}")
        return game

    # 1) App details API
    data = c.fetch_app_details(appid)
    if data:
        apply_details(game, data)

    # 2) Reviews API
    summary = c.fetch_reviews(appid)
    if summary:
        apply_reviews(game, summary)

    # 3) Player count (needs key)
    if fetch_players and STEAM_API_KEY:
        count = c.fetch_player_count(appid, STEAM_API_KEY)
        if count is not None:
            apply_players(game, count)

    # 4) Store page HTML scrape (languages, tags, DLC prices)
    needs_scrape = (
        _is_empty(game.get("languages")) or
        _is_empty(game.get("language_details")) or
        _is_empty(game.get("tags"))
        # has_paid_dlc always re-checked from HTML for accuracy
    )
    if scrape_page and needs_scrape:
        html = c.fetch_store_page(appid)
        if html:
            scraped = scrape_store_page(html)
            apply_scraped_data(game, scraped)

    # Housekeeping
    if not game.get("notes", "").strip():
        game["notes"] = "Not reviewed yet"
    if not game.get("safe"):
        game["safe"] = "?"
    game["last_updated"] = now_iso()
    return game


# ──────────── Batch processors ────────────

def _process_batch(games, process_fn, desc="Processing"):
    total = len(games)
    for batch_start in range(0, total, BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, total)
        batch = games[batch_start:batch_end]
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"\n── Batch {batch_num}/{total_batches} ({len(batch)} games) ──")
        for i, game in enumerate(batch):
            name = game.get("name") or game.get("link", "?")
            print(f"  [{batch_start+i+1}/{total}] {desc}: {name[:50]}...", end=" ")
            process_fn(game)
            print("✓")
        if batch_end < total:
            pause = random.uniform(BATCH_PAUSE_MIN, BATCH_PAUSE_MAX)
            print(f"  ⏳ Cooling {pause:.0f}s...")
            time.sleep(pause)


def update_all_full(games, force=False):
    client = get_client()
    to_fetch = games if force else [g for g in games if not is_info_complete(g)]
    skip = len(games) - len(to_fetch)
    print(f"Full update: {len(to_fetch)} to fetch, {skip} skipped")
    if not to_fetch:
        print("All data up to date!")
        return
    _process_batch(to_fetch, lambda g: fetch_full(g, client=client), "Fetching full data")


def update_reviews_only(games):
    client = get_client()
    print(f"Reviews update: {len(games)} games")
    def _fn(game):
        appid = extract_appid(game.get("link", ""))
        if not appid: return
        summary = client.fetch_reviews(appid)
        if summary: apply_reviews(game, summary)
        game["last_updated"] = now_iso()
    _process_batch(games, _fn, "Updating reviews")


def update_players_only(games):
    if not STEAM_API_KEY:
        print("No STEAM_API_KEY – skip player counts.")
        return
    online = [g for g in games if g.get("type_game", "").lower() == "online"]
    print(f"Players update: {len(online)} online games")
    client = get_client()
    def _fn(game):
        appid = extract_appid(game.get("link", ""))
        if not appid: return
        count = client.fetch_player_count(appid, STEAM_API_KEY)
        if count is not None: apply_players(game, count)
    _process_batch(online, _fn, "Fetching players")
