"""
Ingest new game links.

Flow:
  1. Read temp_info.jsonl  (each line: {"link": "..."} or dict with manual fields)
  2. Validate & normalize each link
  3. Skip duplicates already in data.jsonl
  4. PRE-FLIGHT HEALTH CHECK – reject games that are:
     - invalid link format
     - 404/410 on Steam
     - delisted / unavailable
     - no longer free-to-play
  5. Fetch full data from Steam for healthy new games
  6. Append to data.jsonl
  7. Log rejected games to removed_games.jsonl
  8. Clear temp_info.jsonl
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.constants import REMOVED_JSONL
from core.data_store import (
    load_main, save_main, load_temp, clear_temp,
    load_jsonl, save_jsonl,
    normalize_link, extract_appid, build_index, make_skeleton, now_iso,
)
from core.fetcher import fetch_full
from core.steam_client import get_client
from core.health_checker import check_game_health, NETWORK_ERROR


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


def log_rejected(rejected: list[dict]):
    """Append rejected entries to the removal log."""
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
        raw_link = entry["link"]
        link = normalize_link(raw_link)

        if not link:
            print(f"  ✗ Invalid link format, skipping: {raw_link[:80]}")
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
            print(f"  ⏭ Duplicate (appid {appid}), skipping")
            skipped_dup += 1
            continue

        # ── Pre-flight health check ──
        print(f"  🔍 Health check (appid {appid})...", end=" ")
        health = check_game_health(link, name="", client=client)

        if health.status == NETWORK_ERROR:
            # Transient – don't reject, but don't add either
            print(f"⚠ Network error – skipping (try again later)")
            skipped_network += 1
            continue

        if health.should_remove:
            print(f"❌ {health.reason}")
            rejected_log.append({
                "link": link, "name": health.name, "appid": appid,
                "reason": health.reason,
                "status_code": health.status,
                "removed_at": now_iso(),
            })
            skipped_unhealthy += 1
            continue

        print("✅ Healthy")

        # ── Passed checks – proceed with ingest ──

        # 1) Create skeleton
        game = make_skeleton(link)

        # 2) Apply manual overrides BEFORE fetch
        manual_overrides = {}
        for key in MANUAL_FIELDS:
            val = entry.get(key)
            if val is not None and str(val).strip():
                game[key] = str(val).strip()
                manual_overrides[key] = game[key]

        if manual_overrides:
            print(f"  📝 Manual fields: {manual_overrides}")

        # 3) Fetch from Steam (respects pre-filled genre, anti_cheat, etc.)
        print(f"  ➕ Fetching full data for appid {appid}...")
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
    log_rejected(rejected_log)
    clear_temp()

    print(f"\n{'─'*50}")
    print(f"Done! Added: {added}")
    print(f"  Dup skipped  : {skipped_dup}")
    print(f"  Invalid link : {skipped_invalid}")
    print(f"  Unhealthy    : {skipped_unhealthy}")
    print(f"  Network err  : {skipped_network} (not rejected, retry later)")
    if rejected_log:
        print(f"  Logged {len(rejected_log)} rejection(s) to {REMOVED_JSONL}")
    print(f"Total games in data.jsonl: {len(games)}")


if __name__ == "__main__":
    main()
