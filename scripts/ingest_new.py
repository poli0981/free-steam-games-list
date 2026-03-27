#!/usr/bin/env python3
"""
Ingest new game links v2.1.

Handles two input formats:
  1. Simple:  {"link": "730"}
  2. Rich:    Full extension output with developer[], publisher[], platforms[],
              languages[], language_details[], tags[], description, etc.

Flow:
  1. Read temp_info.jsonl
  2. Validate & normalize each link
  3. Skip duplicates
  4. Pre-flight health check
  5. Create skeleton → merge extension data → fetch from Steam (enrichment only)
  6. Re-apply MANUAL_FIELDS overrides
  7. Append to data.jsonl
  8. Log rejected entries
  9. Clear temp_info.jsonl
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.constants import REMOVED_JSONL, MANUAL_FIELDS
from core.data_store import (
    load_main, save_main, load_temp, clear_temp,
    load_jsonl, save_jsonl,
    normalize_link, extract_appid, build_index,
    make_skeleton, merge_extension_data, now_iso,
)
from core.fetcher import fetch_full
from core.steam_client import get_client
from core.health_checker import check_game_health, NETWORK_ERROR


def parse_temp_entries(temp_records: list) -> list[dict]:
    entries = []
    for rec in temp_records:
        if isinstance(rec, str):
            entries.append({"link": rec.strip()})
        elif isinstance(rec, dict) and rec.get("link"):
            entries.append(rec)
        else:
            print(f"  ⚠ Skipping unrecognized entry: {rec}")
    return entries


def log_rejected(rejected: list[dict]):
    if not rejected:
        return
    existing = load_jsonl(REMOVED_JSONL)
    existing.extend(rejected)
    save_jsonl(REMOVED_JSONL, existing)


def main():
    temp_records = load_temp()
    if not temp_records:
        print("temp_info.jsonl is empty – nothing to ingest.")
        return

    games = load_main()
    index = build_index(games)
    entries = parse_temp_entries(temp_records)

    print(f"Found {len(entries)} entries in temp_info.jsonl\n")

    added = 0
    skipped_invalid = 0
    skipped_dup = 0
    skipped_unhealthy = 0
    skipped_network = 0
    rejected_log: list[dict] = []
    client = get_client()

    for entry in entries:
        raw_link = entry.get("link", "")
        link = normalize_link(raw_link)

        if not link:
            print(f"  ✗ Invalid link: {raw_link[:80]}")
            rejected_log.append({
                "link": raw_link, "name": "", "appid": "",
                "reason": "Invalid link format",
                "status_code": "invalid_format",
                "removed_at": now_iso(),
            })
            skipped_invalid += 1
            continue

        appid = extract_appid(link)
        if appid in index:
            print(f"  ⏭ Duplicate (appid {appid})")
            skipped_dup += 1
            continue

        # Health check
        print(f"  🔍 Health check ({appid})...", end=" ")
        health = check_game_health(link, name=entry.get("name", ""), client=client)

        if health.status == NETWORK_ERROR:
            print("⚠ Network error – skip (retry later)")
            skipped_network += 1
            continue

        if health.should_remove:
            print(f"❌ {health.reason}")
            rejected_log.append({
                "link": link, "name": health.name, "appid": appid,
                "reason": health.reason, "status_code": health.status,
                "removed_at": now_iso(),
            })
            skipped_unhealthy += 1
            continue

        print("✅ Healthy")

        # ── Build record ──

        # 1) Skeleton
        game = make_skeleton(link)

        # 2) Merge ALL extension-provided data (rich fields)
        #    This handles developer[], publisher[], platforms[], languages[],
        #    language_details[], tags[], description, etc.
        has_ext_data = any(k in entry for k in ("developer", "platforms", "tags", "description"))
        if has_ext_data:
            print(f"  📦 Extension data: {sum(1 for k in entry if k != 'link')} fields")

        merge_extension_data(game, entry)

        # 3) Save manual overrides that must survive API fetch
        manual_overrides = {}
        for key in MANUAL_FIELDS:
            val = game.get(key)
            if val is not None and val != "" and val != "-" and val != "?" and val != []:
                manual_overrides[key] = val

        # 4) Fetch from Steam (enrichment – only fills empty fields)
        print(f"  ➕ Fetching from Steam (appid {appid})...")
        fetch_full(game, client=client)

        # 5) Re-apply manual overrides
        for key, val in manual_overrides.items():
            game[key] = val

        games.append(game)
        index[appid] = len(games) - 1
        added += 1

        # Summary line
        dev = game.get("developer", [])
        dev_str = dev[0] if isinstance(dev, list) and dev else str(dev)
        plat = ", ".join(game.get("platforms", []))
        lang_count = len(game.get("languages", []))
        tag_count = len(game.get("tags", []))
        print(f"     → {game.get('name', '?')} [{game.get('genre', '?')}] "
              f"dev={dev_str} plat=[{plat}] langs={lang_count} tags={tag_count}")

    # Save
    save_main(games)
    log_rejected(rejected_log)
    clear_temp()

    print(f"\n{'─'*60}")
    print(f"Done! Added: {added}")
    print(f"  Dup skipped  : {skipped_dup}")
    print(f"  Invalid link : {skipped_invalid}")
    print(f"  Unhealthy    : {skipped_unhealthy}")
    print(f"  Network err  : {skipped_network}")
    if rejected_log:
        print(f"  Logged {len(rejected_log)} rejection(s) to {REMOVED_JSONL}")
    print(f"Total games: {len(games)}")


if __name__ == "__main__":
    main()
