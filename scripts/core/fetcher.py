"""
Steam fetcher – populates / refreshes game records from Steam APIs.

Uses SteamClient for all HTTP with built-in rate limiting.
Processes games in batches with inter-batch pauses to avoid bans.
"""
import random
import time

from .constants import (
    STEAM_API_KEY, SKIP_GENRES,
    BATCH_SIZE, BATCH_PAUSE_MIN, BATCH_PAUSE_MAX,
)
from .steam_client import get_client
from .data_store import extract_appid, now_iso, is_info_complete


# ──────────── Single-game updaters ────────────

def apply_details(game: dict, data: dict) -> dict:
    """Merge store API details into a game record."""
    game["name"] = data.get("name", game.get("name", "Unknown"))

    if not game.get("desc") or game["desc"] in ("N/A", "No description", ""):
        game["desc"] = (data.get("short_description") or "N/A").strip()

    game["header_image"] = data.get("header_image",
        "https://via.placeholder.com/460x215?text=No+Image")

    # Genre: keep manual override; otherwise pick first non-tag genre
    if not game.get("genre") or game["genre"] in ("N/A", "", "Uncategorized"):
        genres_raw = [g["description"] for g in data.get("genres", [])]
        filtered = [g for g in genres_raw if g not in SKIP_GENRES]
        game["genre"] = filtered[0] if filtered else (
            genres_raw[0] if genres_raw else "Uncategorized"
        )

    game["developer"] = ", ".join(data.get("developers", [])) or "N/A"
    game["release_date"] = data.get("release_date", {}).get("date", "N/A")

    # Anti-cheat
    if not game.get("anti_cheat") or game["anti_cheat"] == "-":
        ac = "-"
        for cat in data.get("categories", []):
            desc = cat.get("description", "")
            if "Valve Anti-Cheat" in desc:
                ac = "VAC"
                break
            if "Easy Anti-Cheat" in desc.replace("-", " "):
                ac = "EAC"
                break
        game["anti_cheat"] = ac

    # Metacritic score (new column)
    mc = data.get("metacritic", {})
    if mc and mc.get("score"):
        game["metacritic"] = str(mc["score"])

    # DRM notes (new column) – from PC requirements or known DRM
    drm_info = []
    for cat in data.get("categories", []):
        d = cat.get("description", "")
        if "requires" in d.lower() and "account" in d.lower():
            drm_info.append(d)
    if data.get("drm_notice"):
        drm_info.append(data["drm_notice"])
    if drm_info:
        game["drm_notes"] = "; ".join(drm_info[:2])
    elif not game.get("drm_notes") or game["drm_notes"] == "-":
        game["drm_notes"] = "None detected"

    # Free-to-play check
    is_free = data.get("is_free", False)
    price = data.get("price_overview", {})
    if price:
        is_free = is_free or price.get("initial", 1) == 0
    if not is_free and "(No longer free" not in game.get("notes", ""):
        game["notes"] = (game.get("notes", "") + " ⚠ No longer free! Check price.").strip()

    return game


def apply_reviews(game: dict, summary: dict) -> dict:
    """Merge review summary into a game record."""
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
    # Track daily peak
    old_peak = game.get("peak_today", "N/A")
    if old_peak in ("N/A", "Error", ""):
        game["peak_today"] = f"{count:,}"
    else:
        try:
            old_val = int(old_peak.replace(",", ""))
            if count > old_val:
                game["peak_today"] = f"{count:,}"
        except ValueError:
            game["peak_today"] = f"{count:,}"
    return game


# ──────────── Full single-game fetch ────────────

def fetch_full(game: dict, client=None, fetch_players: bool = True) -> dict:
    """Fetch all available data for one game record."""
    c = client or get_client()
    appid = extract_appid(game.get("link", ""))
    if not appid:
        print(f"    ✗ Invalid link: {game.get('link', '?')}")
        return game

    # 1) App details
    data = c.fetch_app_details(appid)
    if data:
        apply_details(game, data)

    # 2) Reviews
    summary = c.fetch_reviews(appid)
    if summary:
        apply_reviews(game, summary)

    # 3) Player count (needs key)
    if fetch_players and STEAM_API_KEY:
        count = c.fetch_player_count(appid, STEAM_API_KEY)
        if count is not None:
            apply_players(game, count)

    # 4) Housekeeping
    if not game.get("notes", "").strip():
        game["notes"] = "Not reviewed yet"
    if not game.get("safe"):
        game["safe"] = "?"
    game["last_updated"] = now_iso()

    return game


# ──────────── Batch processors ────────────

def _process_batch(games: list[dict], process_fn, desc: str = "Processing"):
    """
    Run process_fn on each game in batches of BATCH_SIZE
    with inter-batch pauses.
    """
    total = len(games)
    for batch_start in range(0, total, BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, total)
        batch = games[batch_start:batch_end]
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"\n── Batch {batch_num}/{total_batches} ({len(batch)} games) ──")

        for i, game in enumerate(batch):
            name = game.get("name") or game.get("link", "?")
            idx = batch_start + i + 1
            print(f"  [{idx}/{total}] {desc}: {name[:50]}...", end=" ")
            process_fn(game)
            print("✓")

        # Inter-batch cooldown
        if batch_end < total:
            pause = random.uniform(BATCH_PAUSE_MIN, BATCH_PAUSE_MAX)
            print(f"  ⏳ Cooling down {pause:.0f}s before next batch...")
            time.sleep(pause)


def update_all_full(games: list[dict], force: bool = False):
    """
    Full update: details + reviews + players for games missing info.
    Set force=True to re-fetch everything.
    """
    client = get_client()
    to_fetch = games if force else [g for g in games if not is_info_complete(g)]
    skip = len(games) - len(to_fetch)
    print(f"Full update: {len(to_fetch)} to fetch, {skip} already complete (skipped)")

    if not to_fetch:
        print("Nothing to fetch – all data is up to date!")
        return

    _process_batch(
        to_fetch,
        lambda g: fetch_full(g, client=client),
        desc="Fetching full data",
    )


def update_reviews_only(games: list[dict]):
    """Update only reviews for all games."""
    client = get_client()
    print(f"Reviews update: {len(games)} games")

    def _update_review(game):
        appid = extract_appid(game.get("link", ""))
        if not appid:
            return
        summary = client.fetch_reviews(appid)
        if summary:
            apply_reviews(game, summary)
        game["last_updated"] = now_iso()

    _process_batch(games, _update_review, desc="Updating reviews")


def update_players_only(games: list[dict]):
    """Update only player counts for online games."""
    if not STEAM_API_KEY:
        print("No STEAM_API_KEY – cannot fetch player counts.")
        return

    online = [g for g in games if g.get("type_game", "").lower() == "online"]
    print(f"Players update: {len(online)} online games")
    client = get_client()

    def _update_players(game):
        appid = extract_appid(game.get("link", ""))
        if not appid:
            return
        count = client.fetch_player_count(appid, STEAM_API_KEY)
        if count is not None:
            apply_players(game, count)

    _process_batch(online, _update_players, desc="Fetching players")
