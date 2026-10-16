#!/usr/bin/env python3
"""
Ingest new games v2.2.

Key optimization: health_checker now returns cached API data in HealthResult.data,
so fetch_full() can skip its own fetch_app_details() call → eliminates double-fetch.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.blocklist import blocked_appids
from core.constants import REMOVED_JSONL
from core.data_store import (
    load_main, save_main, load_temp, clear_temp,
    load_jsonl, save_jsonl, dedup_removed,
    normalize_link, extract_appid, build_index,
    make_skeleton, now_iso,
)
from core.fetcher import fetch_full
from core.overrides import OverrideGuard
from core.steam_client import get_client
from core.health_checker import check_game_health, NETWORK_ERROR


def _link_text(value) -> str:
    """A queued link as text. `{"link": 730}` used to reach normalize_link() as
    an int and crash the run before it saved or cleared the queue - so it
    crashed again on every three-hourly retry. A number is an appid; anything
    else that is not text becomes "" and is reported as an invalid line."""
    if isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value)
    return value.strip() if isinstance(value, str) else ""


def parse_entries(records):
    """The queued links, as [{"link": text}]. A line is a store link and
    nothing else: /admin writes {"link": url}, and any other key on a line -
    the retired browser extension sent a whole record - is ignored, so a
    queued line can never decide a field. The game comes from Steam."""
    entries = []
    for rec in records:
        if isinstance(rec, (str, int)) and not isinstance(rec, bool):
            entries.append({"link": _link_text(rec)})
        elif isinstance(rec, dict) and rec.get("link") not in (None, ""):
            entries.append({"link": _link_text(rec["link"])})
    return entries


def main():
    temp = load_temp()
    if not temp:
        print("temp_info.jsonl is empty.")
        return

    games = load_main()
    index = build_index(games)
    entries = parse_entries(temp)
    # data/blocklist.jsonl: games the maintainer removed. save_main() would
    # drop them anyway; skipping here also saves the Steam requests.
    blocked = blocked_appids()
    print(f"Found {len(entries)} entries\n")

    added = skipped_dup = skipped_bad = skipped_net = skipped_blocked = 0
    rejected = []
    client = get_client()
    # A restored game keeps its overrides: fetch_full() must not write a
    # manual field one of them would undo.
    guard = OverrideGuard.load()

    for entry in entries:
        link = normalize_link(entry.get("link", ""))
        if not link:
            print(f"  ✗ Invalid: {entry.get('link', '?')[:60]}")
            rejected.append({"link": entry.get("link", ""), "reason": "Invalid format",
                             "status_code": "invalid_format", "removed_at": now_iso()})
            skipped_bad += 1
            continue

        appid = extract_appid(link)
        if appid in blocked:
            print(f"  ⛔ Blocked ({appid}): removed by the maintainer, see data/blocklist.jsonl")
            skipped_blocked += 1
            continue
        if appid in index:
            print(f"  ⏭ Dup ({appid})")
            skipped_dup += 1
            continue

        # Health check (also fetches appdetails → cached in result.data)
        print(f"  🔍 {appid}...", end=" ")
        health = check_game_health(link, "", client)

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
        # The catalogue is games. Discovery only proposes appdetails type
        # "game", but this queue also takes a link a pull request adds and -
        # with auto-approve on - candidates nobody looked at, so a free DLC,
        # demo or tool is refused HERE, where Steam's own answer is in hand.
        # Not in health_checker: Purge uses it, and would start deleting records.
        app_type = str((health.data or {}).get("type") or "").strip().lower()
        if app_type and app_type != "game":
            print(f"❌ not a game (Steam type: {app_type})")
            rejected.append({"link": link, "name": health.name, "appid": appid,
                             "reason": f"Not a game (Steam type: {app_type})",
                             "status_code": "not_a_game", "removed_at": now_iso()})
            skipped_bad += 1
            continue
        print("✅")

        # Build the record from Steam (reusing the health check's appdetails,
        # so no second call). Human values arrive through overrides, which
        # save_main() re-imposes.
        game = make_skeleton(link)
        print(f"  ➕ Fetching ({appid})...")
        fetch_full(game, client=client, prefetched_details=health.data, guard=guard)

        games.append(game)
        index[appid] = len(games) - 1
        added += 1

        dev = game.get("developer", [])
        print(f"     → {game.get('name', '?')} [{game.get('genre', '?')}] "
              f"dev={dev[0] if dev else '?'} tags={len(game.get('tags', []))}")

    save_main(games)
    if rejected:
        existing = load_jsonl(REMOVED_JSONL)
        save_jsonl(REMOVED_JSONL, dedup_removed(existing + rejected))
    clear_temp()

    print(f"\n{'─'*50}")
    print(f"Added: {added} | Dup: {skipped_dup} | Bad: {skipped_bad} | Net: {skipped_net}"
          f" | Blocked: {skipped_blocked}")
    print(f"Total: {len(games)}")


if __name__ == "__main__":
    main()
