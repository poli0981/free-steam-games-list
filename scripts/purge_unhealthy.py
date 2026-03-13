#!/usr/bin/env python3
"""
Purge unhealthy games from data.jsonl.

Scans all games and removes those with statuses:
  - invalid_format   : link cannot be parsed
  - not_found_404    : Steam store returns 404
  - not_found_410    : Steam store returns 410 (Gone)
  - unavailable      : appdetails success=false (delisted)
  - not_free         : game is no longer free-to-play

Removed games are logged to scripts/removed_games.jsonl with:
  { link, name, appid, reason, removed_at }

Games with transient network errors are SKIPPED (not removed).
"""
import sys
import os
import random
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.constants import (
    REMOVED_JSONL,
    BATCH_SIZE, BATCH_PAUSE_MIN, BATCH_PAUSE_MAX,
)
from core.data_store import load_main, save_main, load_jsonl, save_jsonl, now_iso
from core.steam_client import get_client
from core.health_checker import (
    check_game_health, HealthResult,
    REMOVABLE_STATUSES, NETWORK_ERROR, OK,
)


def log_removal(removed_list: list[dict]):
    """Append removed game records to the removal log file."""
    existing = load_jsonl(REMOVED_JSONL)
    existing.extend(removed_list)
    save_jsonl(REMOVED_JSONL, existing)
    print(f"  📝 Logged {len(removed_list)} removal(s) to {REMOVED_JSONL}")


def main():
    games = load_main()
    if not games:
        print("data.jsonl is empty – nothing to purge.")
        return

    print(f"Scanning {len(games)} games for unhealthy status...\n")

    client = get_client()
    to_remove_indices: set[int] = set()
    removal_log: list[dict] = []
    stats = {"ok": 0, "removed": 0, "skipped_network": 0}

    total = len(games)
    for batch_start in range(0, total, BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, total)
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"── Batch {batch_num}/{total_batches} "
              f"(games {batch_start+1}–{batch_end}) ──")

        for i in range(batch_start, batch_end):
            game = games[i]
            name = game.get("name") or game.get("link", "?")
            idx_display = i + 1

            result: HealthResult = check_game_health(
                link=game.get("link", ""),
                name=name,
                client=client,
            )

            if result.is_healthy:
                print(f"  [{idx_display}/{total}] ✅ {name[:50]}")
                stats["ok"] += 1

            elif result.should_remove:
                print(f"  [{idx_display}/{total}] ❌ {name[:50]} → {result.reason}")
                to_remove_indices.add(i)
                removal_log.append({
                    "link": game.get("link", ""),
                    "name": result.name or name,
                    "appid": result.appid or "",
                    "reason": result.reason,
                    "status_code": result.status,
                    "removed_at": now_iso(),
                })
                stats["removed"] += 1

            else:
                # NETWORK_ERROR – transient, skip
                print(f"  [{idx_display}/{total}] ⚠ {name[:50]} → {result.reason} (kept)")
                stats["skipped_network"] += 1

        # Inter-batch cooldown
        if batch_end < total:
            pause = random.uniform(BATCH_PAUSE_MIN, BATCH_PAUSE_MAX)
            print(f"  ⏳ Cooling down {pause:.0f}s...\n")
            time.sleep(pause)

    # ── Apply removals ──
    if to_remove_indices:
        cleaned = [g for i, g in enumerate(games) if i not in to_remove_indices]
        save_main(cleaned)
        log_removal(removal_log)
        print(f"\n{'─'*50}")
        print(f"Purged {len(to_remove_indices)} game(s) from data.jsonl")
        print(f"Remaining: {len(cleaned)} games")
    else:
        print(f"\n{'─'*50}")
        print("No unhealthy games found – data.jsonl unchanged.")

    print(f"\nSummary: ✅ {stats['ok']} healthy | "
          f"❌ {stats['removed']} removed | "
          f"⚠ {stats['skipped_network']} network errors (kept)")

    # Breakdown by reason
    if removal_log:
        from collections import Counter
        reasons = Counter(r["status_code"] for r in removal_log)
        print("\nRemoval breakdown:")
        for code, count in reasons.most_common():
            label = next((r["reason"] for r in removal_log if r["status_code"] == code), code)
            print(f"  {label}: {count}")


if __name__ == "__main__":
    main()
