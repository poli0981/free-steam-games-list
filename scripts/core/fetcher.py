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
from typing import Optional

from .constants import (
    STEAM_API_KEY, SKIP_GENRE_TAGS, ANTI_CHEAT_PATTERNS,
    BATCH_SIZE, BATCH_PAUSE_MIN, BATCH_PAUSE_MAX,
)
from .steam_client import get_client
from .data_store import extract_appid, now_iso, is_info_complete, is_empty
from .normalize import decode_entities, normalize_release_date
from .peaks import raise_peak
from .scraper import scrape_store_page
from .store_items import paid_dlc_from_items, parse_store_item


# Steam category descriptions that imply online multiplayer. Bias toward
# "online" only when the signal is clear (Online PvP, MMO, Cross-Platform
# Multiplayer, etc.). Pure "Shared/Split Screen" games fall through to the
# empty default and become "offline" at the end of fetch_full.
_ONLINE_CATEGORY_TOKENS = (
    "online",                       # Online PvP, Online Co-op, etc.
    "mmo",
    "massively multiplayer",
    "cross-platform multiplayer",
    "multi-player",                 # Steam's catch-all multiplayer tag
)
_LOCAL_ONLY_TOKENS = ("shared/split screen",)


def _infer_type_game(categories: list[dict]) -> str:
    """Return 'online' if any category signals online multiplayer, else ''
    (caller falls back to 'offline'). Local-only signals are ignored unless
    paired with an online signal in another category."""
    for cat in categories:
        desc = (cat.get("description") or "").lower()
        if not desc:
            continue
        if any(tok in desc for tok in _LOCAL_ONLY_TOKENS) and not any(
            tok in desc for tok in ("online", "mmo", "cross-platform")
        ):
            continue
        if any(tok in desc for tok in _ONLINE_CATEGORY_TOKENS):
            return "online"
    return ""


# ──────────── Apply functions ────────────

def apply_details(game: dict, data: dict) -> dict:
    """Merge API appdetails. Only fills empty fields."""
    if is_empty(game.get("name")):
        game["name"] = data.get("name", "")

    if is_empty(game.get("description")):
        # appdetails returns the blurb HTML-escaped ("&quot;game&quot;").
        sd = decode_entities((data.get("short_description") or "").strip())
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
        game["release_date"] = normalize_release_date(
            data.get("release_date", {}).get("date", "N/A"))

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

    # Infer type_game from categories when not manually set. Manual prefills
    # win because MANUAL_FIELDS gates the merge in merge_extension_data(),
    # and ingest_new.py re-applies overrides after fetch_full.
    if is_empty(game.get("type_game")):
        inferred = _infer_type_game(data.get("categories", []))
        if inferred:
            game["type_game"] = inferred

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
    # A sample of 0 says nothing about a peak; anything else may beat it.
    if count > 0:
        raise_peak(game, count)
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
    """Apply scraped store-page data (languages, tags, DLC)."""
    if is_empty(game.get("languages")) and scraped.get("languages"):
        game["languages"] = scraped["languages"]
    if is_empty(game.get("language_details")) and scraped.get("language_details"):
        game["language_details"] = scraped["language_details"]
    if is_empty(game.get("tags")) and scraped.get("tags"):
        game["tags"] = scraped["tags"]
    # DLC: the store page is authoritative, and so are the prices of the DLC
    # appdetails lists when the page is gated. None means neither could be
    # read and leaves the stored value alone - an age gate once wrote False.
    if scraped.get("has_paid_dlc") is not None:
        game["has_paid_dlc"] = scraped["has_paid_dlc"]
    return game


# ──────────── Store-page fields ────────────

def _paid_dlc(client, appid: str, details: Optional[dict]) -> Optional[bool]:
    """has_paid_dlc for a game whose store page could not be read: whether any
    DLC appdetails lists has a price. None when that cannot be told."""
    if details is None:
        details = client.fetch_app_details(appid)
    if not details:
        return None
    dlc = [str(d) for d in details.get("dlc") or []]
    if not dlc:
        return False
    items = client.fetch_store_items(dlc)
    return None if items is None else paid_dlc_from_items(items.values())


def scrape_store_fields(client, appid: str, details: Optional[dict] = None) -> Optional[dict]:
    """languages, language_details, tags and has_paid_dlc for one game, in
    scrape_store_page()'s shape, or None when nothing could be read.

    The store page first. Where Steam will not show it - the age gate, which
    for an 'Adult Only' game is a Sign In page no cookie opens, or a redirect
    away from the game - the same facts come from Steam's JSON API
    (core/store_items.py), and has_paid_dlc from the prices of the game's DLC.
    A page missing its language table or its tags gets only the missing part
    from the API. A failed request, or a 404, reads as nothing at all.

    `details` is the game's appdetails when the caller already has them; they
    are fetched here only if a DLC check needs them.
    """
    status, page = client.fetch_store_page_full(appid)
    if status in ("network_error", "not_found"):
        return None
    scraped = scrape_store_page(page) if status == "ok" else None
    real_page = bool(scraped and (scraped["languages"] or scraped["tags"]))
    if real_page and scraped["languages"] and scraped["tags"]:
        return scraped

    item = (client.fetch_store_items([appid]) or {}).get(str(appid))
    if item is None:
        return scraped if real_page else None
    api = parse_store_item(item, client.fetch_tag_names())
    if not real_page:
        api["has_paid_dlc"] = _paid_dlc(client, appid, details)
        return api
    if not scraped["languages"] and api["languages"]:
        scraped["languages"] = api["languages"]
        scraped["language_details"] = api["language_details"]
    if not scraped["tags"]:
        scraped["tags"] = api["tags"]
    return scraped


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

    # 4) Store page (languages + tags + DLC pricing) – single request, or
    #    Steam's JSON API when the page is gated (scrape_store_fields).
    #    Always scrape if has_paid_dlc hasn't been set by extension,
    #    or if any of languages/tags/language_details are missing.
    needs_scrape = (
        is_empty(game.get("languages")) or
        is_empty(game.get("tags")) or
        is_empty(game.get("language_details")) or
        not game.get("_dlc_checked")  # internal flag: DLC not yet verified from HTML
    )
    if scrape and needs_scrape:
        scraped = scrape_store_fields(c, appid, details=data)
        if scraped:
            apply_scraped(game, scraped)
            game["_dlc_checked"] = True

    # Housekeeping
    game.pop("_dlc_checked", None)  # internal flag, don't persist
    if not game.get("type_game"):
        game["type_game"] = "offline"
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


def update_players_only(games, type_filter: str = "online"):
    """Refresh `current_players` + `peak_today` for the games matching
    `type_filter`. Default 'online' preserves the historical behaviour
    used by top_online.py.

    type_filter:
      - "online"  → only games with type_game == 'online' (default).
      - "offline" → games with a non-empty type_game that is NOT 'online'
                    (single-player, story, etc). Empty type_game is
                    excluded — those are unclassified, not offline.
      - "all"     → every game with a non-empty type_game.
    """
    if not STEAM_API_KEY:
        print("No STEAM_API_KEY.")
        return
    if type_filter == "offline":
        target = [
            g for g in games
            if (g.get("type_game", "").lower() or "") not in ("online", "")
        ]
    elif type_filter == "all":
        target = [g for g in games if g.get("type_game", "")]
    else:  # "online" (default + safety fallback)
        target = [g for g in games if g.get("type_game", "").lower() == "online"]
    print(f"Players update ({type_filter}): {len(target)} games")
    client = get_client()
    def fn(g):
        appid = extract_appid(g.get("link", ""))
        if not appid: return
        count = client.fetch_player_count(appid, STEAM_API_KEY)
        if count is not None: apply_players(g, count)
    process_batch(target, fn, "Players")
