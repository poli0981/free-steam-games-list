#!/usr/bin/env python3
"""
Ingest new games v2.1.

Key optimization: health_checker now returns cached API data in HealthResult.data,
so fetch_full() can skip its own fetch_app_details() call → eliminates double-fetch.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.constants import REMOVED_JSONL, MANUAL_FIELDS
from core.data_store import (
    load_main, save_main, load_temp, clear_temp,
    load_jsonl, save_jsonl,
    normalize_link, extract_appid, build_index,
    make_skeleton, merge_extension_data, now_iso, is_empty,
)
from core.fetcher import fetch_full
from core.steam_client import get_client
from core.health_checker import check_game_health, NETWORK_ERROR


def parse_entries(records):
    entries = []
    for rec in records:
        if isinstance(rec, str):
            entries.append({"link": rec.strip()})
        elif isinstance(rec, dict) and rec.get("link"):
            entries.append(rec)
    return entries


def main():
    temp = load_temp()
    if not temp:
        print("temp_info.jsonl is empty.")
        return

    games = load_main()
    index = build_index(games)
    entries = parse_entries(temp)
    print(f"Found {len(entries)} entries\n")

    added = skipped_dup = skipped_bad = skipped_net = 0
    rejected = []
    client = get_client()

    for entry in entries:
        link = normalize_link(entry.get("link", ""))
        if not link:
            print(f"  ✗ Invalid: {entry.get('link', '?')[:60]}")
            rejected.append({"link": entry.get("link", ""), "reason": "Invalid format",
                             "status_code": "invalid_format", "removed_at": now_iso()})
            skipped_bad += 1
            continue

        appid = extract_appid(link)
        if appid in index:
            print(f"  ⏭ Dup ({appid})")
            skipped_dup += 1
            continue

        # Health check (also fetches appdetails → cached in result.data)
        print(f"  🔍 {appid}...", end=" ")
        health = check_game_health(link, entry.get("name", ""), client)

        if health.status == NETWORK_ERROR:
            print("⚠ network – skip")
            skipped_net += 1
            continue
        if health.should_remove:
            print(f"❌ {health.reason}")
            rejected.append({"link": link, "name": health.name, "appid": appid,
                             "reason": health.reason, "status_code": health.status,
                             "removed_at": now_iso()})
            skipped_bad += 1
            continue
        print("✅")

        # Build record
        game = make_skeleton(link)
        merge_extension_data(game, entry)

        # Save manual overrides
        overrides = {k: game[k] for k in MANUAL_FIELDS
                     if not is_empty(game.get(k))}

        # Fetch (reuse health check data → no second appdetails call)
        print(f"  ➕ Fetching ({appid})...")
        fetch_full(game, client=client, prefetched_details=health.data)

        # Re-apply overrides
        for k, v in overrides.items():
            game[k] = v

        games.append(game)
        index[appid] = len(games) - 1
        added += 1

        dev = game.get("developer", [])
        print(f"     → {game.get('name', '?')} [{game.get('genre', '?')}] "
              f"dev={dev[0] if dev else '?'} tags={len(game.get('tags', []))}")

    save_main(games)
    if rejected:
        existing = load_jsonl(REMOVED_JSONL)
        existing.extend(rejected)
        save_jsonl(REMOVED_JSONL, existing)
    clear_temp()

    print(f"\n{'─'*50}")
    print(f"Added: {added} | Dup: {skipped_dup} | Bad: {skipped_bad} | Net: {skipped_net}")
    print(f"Total: {len(games)}")


if __name__ == "__main__":
    main()
