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


def main():
    temp_records = load_temp()
    if not temp_records:
        print("temp_info.jsonl is empty – nothing to ingest.")
        return

    games = load_main()
    index = build_index(games)

    # Parse links from temp file
    raw_links: list[str] = []
    for rec in temp_records:
        if isinstance(rec, str):
            raw_links.append(rec)
        elif isinstance(rec, dict):
            raw_links.append(rec.get("link", ""))
        else:
            continue

    print(f"Found {len(raw_links)} entries in temp_info.jsonl")

    added = 0
    skipped_invalid = 0
    skipped_dup = 0
    client = get_client()

    for raw in raw_links:
        link = normalize_link(raw)
        if not link:
            print(f"  ✗ Invalid link format, skipping: {raw[:80]}")
            skipped_invalid += 1
            continue

        appid = extract_appid(link)
        if appid in index:
            print(f"  ⏭ Duplicate (appid {appid}), skipping: {link}")
            skipped_dup += 1
            continue

        # Create skeleton & fetch
        game = make_skeleton(link)
        print(f"  ➕ New game (appid {appid}) – fetching from Steam...")
        fetch_full(game, client=client)
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
