#!/usr/bin/env python3
"""
Force re-fetch ALL games into v2.1 schema.

*** MANUAL DISPATCH ONLY – never runs on schedule ***

This script:
  1. Migrates every record to v2.1 skeleton (adds missing fields, normalizes types)
  2. Clears all API-fetchable fields (name, description, developer, publisher, platforms,
     languages, header_image, genre, release_date, reviews, players, metacritic,
     drm_notes, anti_cheat) while PRESERVING manual fields
     (notes, safe, type_game – and anti_cheat/genre/anti_cheat_note IF manually set)
  3. Re-fetches everything from Steam API into the clean schema
  4. Saves the fully refreshed data.jsonl

Why:
  - After upgrading from v2.0 → v2.1, old records have developer as string,
    no publisher/platforms/languages/tags fields, etc.
  - A normal update_data.py skips records that already have data (is_info_complete).
  - This script forces a clean re-fetch so all records are uniform.

Safety:
  - Preserves: notes, safe, type_game, status, added_at, link
  - Preserves anti_cheat/genre/anti_cheat_note ONLY if they look manually set
    (i.e. not the auto-detected defaults)
  - Saves a backup to data.jsonl.bak before starting
  - Batched with rate limiting (same as normal fetch)
"""
import sys
import os
import shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.constants import DATA_JSONL, STEAM_API_KEY, MANUAL_FIELDS
from core.data_store import load_main, save_main, migrate_record, extract_appid, now_iso
from core.fetcher import fetch_full, _process_batch
from core.steam_client import get_client


# Fields that are safe to clear (will be re-fetched from API)
CLEARABLE_FIELDS = {
    "name", "description", "header_image",
    "developer", "publisher", "release_date",
    "reviews", "current_players", "peak_today", "metacritic",
    "drm_notes", "has_paid_dlc",
    "platforms", "languages", "language_details", "tags",
}

# These are cleared ONLY if they hold auto-detect defaults
# (if user manually set them, they're preserved)
CONDITIONAL_CLEAR = {
    "genre":           ("", "N/A", "Uncategorized"),
    "anti_cheat":      ("-",),
    "anti_cheat_note": ("",),
    "is_kernel_ac":    (None,),
}


def clear_fetchable(game: dict) -> dict:
    """
    Reset API-fetchable fields to empty so fetch_full() will re-populate them.
    Preserves truly manual fields (notes, safe, type_game, status, added_at).
    """
    for field in CLEARABLE_FIELDS:
        if field in ("developer", "publisher", "platforms",
                     "languages", "language_details", "tags"):
            game[field] = []
        elif field in ("has_paid_dlc",):
            game[field] = False
        else:
            game[field] = ""

    # Conditional: only clear if value is a known auto-detect default
    for field, defaults in CONDITIONAL_CLEAR.items():
        if game.get(field) in defaults:
            if isinstance(defaults[0], bool) or defaults[0] is None:
                game[field] = defaults[0]
            else:
                game[field] = ""

    # Always clear stats
    game["reviews"] = "N/A"
    game["current_players"] = "N/A"
    game["peak_today"] = "N/A"
    game["metacritic"] = "N/A"

    return game


def main():
    games = load_main()
    if not games:
        print("data.jsonl is empty – nothing to refetch.")
        return

    total = len(games)
    print(f"╔══════════════════════════════════════════════════╗")
    print(f"║  FORCE RE-FETCH: {total} games → v2.1 schema       ║")
    print(f"╚══════════════════════════════════════════════════╝")
    print()

    # ── Backup ──
    backup_path = DATA_JSONL + ".bak"
    shutil.copy2(DATA_JSONL, backup_path)
    print(f"✓ Backup saved to {backup_path}")

    # ── Step 1: Migrate schema ──
    print(f"\n── Step 1/3: Migrate {total} records to v2.1 schema ──")
    for game in games:
        migrate_record(game)
    print(f"  ✓ All records have v2.1 fields")

    # ── Step 2: Clear fetchable fields ──
    print(f"\n── Step 2/3: Clear API-fetchable fields ──")
    preserved_stats = {"notes": 0, "safe": 0, "type_game": 0,
                       "genre_kept": 0, "ac_kept": 0}

    for game in games:
        # Count what we're preserving
        if game.get("notes", "").strip() and game["notes"] != "Not reviewed yet":
            preserved_stats["notes"] += 1
        if game.get("safe", "?") != "?":
            preserved_stats["safe"] += 1
        if game.get("type_game", "offline") != "offline":
            preserved_stats["type_game"] += 1

        # Check if genre/anti_cheat were manually set (non-default)
        genre_val = game.get("genre", "")
        if genre_val and genre_val not in ("", "N/A", "Uncategorized"):
            preserved_stats["genre_kept"] += 1
        ac_val = game.get("anti_cheat", "-")
        if ac_val not in ("-", "", "N/A"):
            preserved_stats["ac_kept"] += 1

        clear_fetchable(game)

    print(f"  Preserved: {preserved_stats['notes']} notes, "
          f"{preserved_stats['safe']} safe ratings, "
          f"{preserved_stats['type_game']} type overrides")
    print(f"  Kept manual: {preserved_stats['genre_kept']} genres, "
          f"{preserved_stats['ac_kept']} anti-cheat values")

    # ── Step 3: Re-fetch all from Steam ──
    print(f"\n── Step 3/3: Re-fetch all {total} games from Steam API ──")
    if not STEAM_API_KEY:
        print("  ⚠ No STEAM_API_KEY – player counts will be skipped")

    client = get_client()
    _process_batch(
        games,
        lambda g: fetch_full(g, client=client),
        desc="Re-fetching",
    )

    # ── Save ──
    # Stamp all records
    for game in games:
        game["last_updated"] = now_iso()

    save_main(games)

    # ── Summary ──
    filled = sum(1 for g in games if g.get("name") and g["name"] != "")
    has_dev_list = sum(1 for g in games if isinstance(g.get("developer"), list) and len(g["developer"]) > 0)
    has_pub = sum(1 for g in games if isinstance(g.get("publisher"), list) and len(g["publisher"]) > 0)
    has_plat = sum(1 for g in games if isinstance(g.get("platforms"), list) and len(g["platforms"]) > 0)
    has_lang = sum(1 for g in games if isinstance(g.get("languages"), list) and len(g["languages"]) > 0)

    print(f"\n{'═'*60}")
    print(f"✓ Re-fetch complete! {total} games saved to {DATA_JSONL}")
    print(f"  Backup at: {backup_path}")
    print(f"\n  Schema compliance:")
    print(f"    name filled   : {filled}/{total}")
    print(f"    developer[]   : {has_dev_list}/{total}")
    print(f"    publisher[]   : {has_pub}/{total}")
    print(f"    platforms[]   : {has_plat}/{total}")
    print(f"    languages[]   : {has_lang}/{total}")
    print(f"{'═'*60}")


if __name__ == "__main__":
    main()
