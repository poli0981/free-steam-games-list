#!/usr/bin/env python3
"""
Ingest new game links.

Flow:
  1. Read temp_info.jsonl  (each line: {"link": "..."} or just a URL string)
  2. Validate & normalize each link
  3. Skip duplicates already in data.jsonl
  4. Fetch full data from Steam for new games
  5. Append to data.jsonl
  6. Clear temp_info.jsonl
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.data_store import (
    load_main, save_main, load_temp, clear_temp,
    normalize_link, extract_appid, build_index, make_skeleton,
)
from core.fetcher import fetch_full
from core.steam_client import get_client


def parse_temp_entries(temp_records: list) -> list[dict]:
    """
    Parse temp_info.jsonl entries into a list of dicts.
    Each entry can be:
      - a bare string (link/appid only)
      - a dict with "link" + optional manual fields
    """
    entries = []
    for rec in temp_records:
        if isinstance(rec, str):
            entries.append({"link": rec.strip()})
        elif isinstance(rec, dict) and rec.get("link"):
            entries.append(rec)
        else:
            print(f"  ⚠ Skipping unrecognized entry: {rec}")
    return entries


# Fields that users can set manually in temp_info.jsonl
# and should NOT be overwritten by Steam fetch
MANUAL_FIELDS = {"anti_cheat", "notes", "type_game", "safe", "genre"}


def main():
    temp_records = load_temp()
    if not temp_records:
        print("temp_info.jsonl is empty – nothing to ingest.")
        return

    games = load_main()
    index = build_index(games)
    entries = parse_temp_entries(temp_records)

    print(f"Found {len(entries)} entries in temp_info.jsonl")

    added = 0
    skipped_invalid = 0
    skipped_dup = 0
    client = get_client()

    for entry in entries:
        link = normalize_link(entry["link"])
        if not link:
            print(f"  ✗ Invalid link format, skipping: {entry['link'][:80]}")
            skipped_invalid += 1
            continue

        appid = extract_appid(link)
        if appid in index:
            print(f"  ⏭ Duplicate (appid {appid}), skipping: {link}")
            skipped_dup += 1
            continue

        # 1) Create skeleton with normalized link
        game = make_skeleton(link)

        # 2) Apply manual overrides BEFORE fetch so fetcher respects them
        manual_overrides = {}
        for key in MANUAL_FIELDS:
            val = entry.get(key)
            if val is not None and str(val).strip():
                game[key] = str(val).strip()
                manual_overrides[key] = game[key]

        if manual_overrides:
            print(f"  📝 Manual fields: {manual_overrides}")

        # 3) Fetch from Steam (respects pre-filled genre, anti_cheat, etc.)
        print(f"  ➕ New game (appid {appid}) – fetching from Steam...")
        fetch_full(game, client=client)

        # 4) Re-apply manual overrides that fetch might have clobbered
        for key, val in manual_overrides.items():
            game[key] = val

        games.append(game)
        index[appid] = len(games) - 1
        added += 1
        print(f"     → {game.get('name', '?')} [{game.get('genre', '?')}]")

    # Save & cleanup
    save_main(games)
    clear_temp()

    print(f"\n{'─'*50}")
    print(f"Done! Added: {added} | Dup skipped: {skipped_dup} | Invalid: {skipped_invalid}")
    print(f"Total games in data.jsonl: {len(games)}")


if __name__ == "__main__":
    main()
