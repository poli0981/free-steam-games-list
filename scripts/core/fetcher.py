"""
Steam fetcher v2.2.

Optimizations vs v2.1:
  - fetch_full() accepts pre-fetched API data (avoids double-fetch after health check)
  - scraper imported at module level (not per-call)
  - apply_details() uses is_empty() from data_store (no re-import)
  - _process_batch() consolidated, no closure overhead
"""
import random
import time

from .constants import (
    STEAM_API_KEY, SKIP_GENRE_TAGS, ANTI_CHEAT_PATTERNS,
    BATCH_SIZE, BATCH_PAUSE_MIN, BATCH_PAUSE_MAX,
)
from .steam_client import get_client
from .data_store import extract_appid, now_iso, is_info_complete, is_empty
from .scraper import scrape_store_page


# ──────────── Apply functions ────────────

def apply_details(game: dict, data: dict) -> dict:
    """Merge API appdetails. Only fills empty fields."""
    if is_empty(game.get("name")):
        game["name"] = data.get("name", "")

    if is_empty(game.get("description")):
        sd = (data.get("short_description") or "").strip()
        if sd:
            game["description"] = sd

    if is_empty(game.get("header_image")):
        img = data.get("header_image", "")
        if img:
            game["header_image"] = img

    if is_empty(game.get("genre")):
        raw = [g["description"] for g in data.get("genres", [])]
        filt = [g for g in raw if g not in SKIP_GENRE_TAGS]
        game["genre"] = filt[0] if filt else (raw[0] if raw else "Uncategorized")

    if is_empty(game.get("developer")):
        devs = data.get("developers", [])
        game["developer"] = devs if isinstance(devs, list) else [devs]

    if is_empty(game.get("publisher")):
        pubs = data.get("publishers", [])
        game["publisher"] = pubs if isinstance(pubs, list) else [pubs]

    if is_empty(game.get("release_date")):
        game["release_date"] = data.get("release_date", {}).get("date", "N/A")

    if is_empty(game.get("platforms")):
        p = data.get("platforms", {})
        plats = []
        if p.get("windows"): plats.append("Windows")
        if p.get("mac"):     plats.append("macOS")
        if p.get("linux"):   plats.append("Linux")
        game["platforms"] = plats

    # Anti-cheat from categories
    ac = game.get("anti_cheat", "-")
    if is_empty(ac) or ac == "-":
        for cat in data.get("categories", []):
            desc_lower = cat.get("description", "").lower()
            for label, pats in ANTI_CHEAT_PATTERNS.items():
                if any(p in desc_lower for p in pats):
                    game["anti_cheat"] = label
                    if is_empty(game.get("anti_cheat_note")):
                        game["anti_cheat_note"] = cat["description"]
                    break
            if game["anti_cheat"] != "-":
                break

    # Metacritic
    mc = data.get("metacritic", {})
    if mc and mc.get("score") and is_empty(game.get("metacritic")):
        game["metacritic"] = str(mc["score"])

    # DRM
    drm = []
    for cat in data.get("categories", []):
        d = cat.get("description", "")
        if "requires" in d.lower() and "account" in d.lower():
            drm.append(d)
    if data.get("drm_notice"):
        drm.append(data["drm_notice"])
    cur_drm = game.get("drm_notes", "-")
    if drm and (is_empty(cur_drm) or cur_drm == "-"):
        game["drm_notes"] = "; ".join(drm[:2])
    elif is_empty(cur_drm) or cur_drm == "-":
        game["drm_notes"] = "None detected"

    # Free check
    is_free = data.get("is_free", False)
    price = data.get("price_overview", {})
    if price:
        is_free = is_free or price.get("initial", 1) == 0
    if not is_free and "No longer free" not in game.get("notes", ""):
        game["notes"] = (game.get("notes", "") + " ⚠ No longer free!").strip()

    return game


def apply_reviews(game: dict, summary: dict) -> dict:
    total = summary.get("total_reviews", 0)
    pos = summary.get("total_positive", 0)
    if total > 0:
        pct = round((pos / total) * 100)
        label = summary.get("review_score_desc", "")
        game["reviews"] = f"{pct}% ({label})" if label else f"{pct}%"
    else:
        game["reviews"] = "No reviews"
    return game


def apply_players(game: dict, count: int) -> dict:
    game["current_players"] = f"{count:,}"
    old = game.get("peak_today", "N/A")
    if old in ("N/A", "Error", ""):
        game["peak_today"] = f"{count:,}"
    else:
        try:
            if count > int(old.replace(",", "")):
                game["peak_today"] = f"{count:,}"
        except ValueError:
            game["peak_today"] = f"{count:,}"
    return game


def apply_scraped(game: dict, scraped: dict) -> dict:
    """Apply HTML-scraped data (languages, tags, DLC)."""
    if is_empty(game.get("languages")) and scraped.get("languages"):
        game["languages"] = scraped["languages"]
    if is_empty(game.get("language_details")) and scraped.get("language_details"):
        game["language_details"] = scraped["language_details"]
    if is_empty(game.get("tags")) and scraped.get("tags"):
        game["tags"] = scraped["tags"]
    # DLC: HTML scrape is authoritative
    game["has_paid_dlc"] = scraped.get("has_paid_dlc", False)
    return game


# ──────────── fetch_full ────────────

def fetch_full(game: dict, client=None, fetch_players=True,
               scrape=True, prefetched_details=None) -> dict:
    """
    Fetch all data for one game.

    Args:
        prefetched_details: If health_checker already fetched appdetails,
                            pass it here to avoid a second API call.
    """
    c = client or get_client()
    appid = extract_appid(game.get("link", ""))
    if not appid:
        return game

    # 1) App details (skip if already have from health check)
    data = prefetched_details
    if data is None:
        data = c.fetch_app_details(appid)
    if data:
        apply_details(game, data)

    # 2) Reviews
    summary = c.fetch_reviews(appid)
    if summary:
        apply_reviews(game, summary)

    # 3) Players
    if fetch_players and STEAM_API_KEY:
        count = c.fetch_player_count(appid, STEAM_API_KEY)
        if count is not None:
            apply_players(game, count)

    # 4) HTML scrape (languages + tags + DLC) – single request
    if scrape and (is_empty(game.get("languages")) or
                   is_empty(game.get("tags")) or
                   is_empty(game.get("language_details"))):
        html = c.fetch_store_page(appid)
        if html:
            apply_scraped(game, scrape_store_page(html))

    # Housekeeping
    if not game.get("notes", "").strip():
        game["notes"] = "Not reviewed yet"
    if not game.get("safe"):
        game["safe"] = "?"
    game["last_updated"] = now_iso()
    return game


# ──────────── Batch processor ────────────

def process_batch(games: list[dict], fn, desc="Processing"):
    """Run fn on each game with batch pauses."""
    total = len(games)
    for bs in range(0, total, BATCH_SIZE):
        be = min(bs + BATCH_SIZE, total)
        batch_num = bs // BATCH_SIZE + 1
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"\n── Batch {batch_num}/{total_batches} ({be - bs} games) ──")
        for i in range(bs, be):
            name = games[i].get("name") or games[i].get("link", "?")
            print(f"  [{i+1}/{total}] {desc}: {name[:50]}...", end=" ")
            fn(games[i])
            print("✓")
        if be < total:
            pause = random.uniform(BATCH_PAUSE_MIN, BATCH_PAUSE_MAX)
            print(f"  ⏳ {pause:.0f}s...")
            time.sleep(pause)


def update_all_full(games, force=False):
    client = get_client()
    to_fetch = games if force else [g for g in games if not is_info_complete(g)]
    print(f"Full update: {len(to_fetch)} to fetch, {len(games)-len(to_fetch)} skipped")
    if not to_fetch:
        print("All up to date!")
        return
    process_batch(to_fetch, lambda g: fetch_full(g, client=client), "Fetching")


def update_reviews_only(games):
    client = get_client()
    print(f"Reviews update: {len(games)} games")
    def fn(g):
        appid = extract_appid(g.get("link", ""))
        if not appid: return
        s = client.fetch_reviews(appid)
        if s: apply_reviews(g, s)
        g["last_updated"] = now_iso()
    process_batch(games, fn, "Reviews")


def update_players_only(games):
    if not STEAM_API_KEY:
        print("No STEAM_API_KEY.")
        return
    online = [g for g in games if g.get("type_game", "").lower() == "online"]
    print(f"Players update: {len(online)} online games")
    client = get_client()
    def fn(g):
        appid = extract_appid(g.get("link", ""))
        if not appid: return
        count = client.fetch_player_count(appid, STEAM_API_KEY)
        if count is not None: apply_players(g, count)
    process_batch(online, fn, "Players")
