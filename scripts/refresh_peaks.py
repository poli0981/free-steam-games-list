#!/usr/bin/env python3
"""
Refresh all_time_peak - the most players each game has had at once - from
SteamCharts, a thirtieth of the catalogue a day.

core/peaks.py explains the field; core/steamcharts.py the source and why it is
read so carefully. Each run does two things:

  1. For EVERY game, raise all_time_peak to the highest of our own samples
     (peak_today and current_players). No requests; this is what gives the
     long tail SteamCharts does not track a number at all, and it seeds the
     field for the whole catalogue on the first run.
  2. For the games whose slice is due (crc32(appid) % 30, see core/rotation.py:
     every game once a month), read SteamCharts' recorded all-time peak and
     raise the field to it.

The rules:
  - all_time_peak only ever goes UP. A failed request, an untracked app or a
    lower number leaves the stored value alone.
  - Nothing else is written: not the MANUAL_FIELDS, not notes, and not
    last_updated, which player counts have never moved either.
  - SteamCharts answers 500 for apps it does not track and 404 for ones it has
    never seen; both are normal and simply skipped until next month.
  - A 403, a 429 or a Cloudflare challenge stops the SteamCharts part of the
    run (everything already raised is kept and saved), and so do ten errors in
    a row. The run still succeeds, with a warning: a refusal is SteamCharts'
    call to make, not a pipeline failure.
  - Everything is written by save_main().

Usage (from the repository root):
  python scripts/refresh_peaks.py                  today's slice
  python scripts/refresh_peaks.py --all            every game (the backfill, ~4 h)
  python scripts/refresh_peaks.py --day 20730      the slice of a given day
  python scripts/refresh_peaks.py --limit 5 --dry-run
"""
import argparse
import os
import sys
from collections import Counter
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.data_store import extract_appid, load_main, migrate_record, save_main
from core.peaks import observed_peak, raise_peak
from core.rotation import day_number, due
from core.steamcharts import SteamChartsClient

PEAK_CYCLE_DAYS = 30
MAX_CONSECUTIVE_ERRORS = 10


def raise_from_samples(games: list[dict]) -> int:
    """Step 1. Returns how many games' all_time_peak went up."""
    return sum(1 for g in games if raise_peak(g, observed_peak(g)))


def raise_from_steamcharts(targets: list[dict], client, log=print) -> Counter:
    """Step 2. Returns a tally of the outcomes: "raised", "unchanged",
    "untracked", "error", and "skipped" for games never asked because the run
    stopped early."""
    tally: Counter = Counter()
    errors_in_a_row = 0
    for i, game in enumerate(targets):
        appid = extract_appid(game.get("link", ""))
        if not appid:
            continue
        result = client.fetch(appid)
        if result.status == "blocked":
            tally["skipped"] += len(targets) - i
            log(f"::warning::SteamCharts refused the request for app {appid}; "
                f"stopping for today with {len(targets) - i} games left.")
            break
        if result.status == "error":
            tally["error"] += 1
            errors_in_a_row += 1
            if errors_in_a_row >= MAX_CONSECUTIVE_ERRORS:
                tally["skipped"] += len(targets) - i - 1
                log(f"::warning::{MAX_CONSECUTIVE_ERRORS} SteamCharts errors in a row "
                    f"(a changed page layout?); stopping for today.")
                break
            continue
        errors_in_a_row = 0
        if result.status == "untracked":
            tally["untracked"] += 1
            continue
        before = game.get("all_time_peak")
        if raise_peak(game, result.peak):
            tally["raised"] += 1
            log(f"  {appid} {game.get('name', '')[:40]}: {before} -> {game['all_time_peak']}")
        else:
            tally["unchanged"] += 1
    return tally


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    ap.add_argument("--all", action="store_true", help="every game, not just today's slice (the backfill)")
    ap.add_argument("--day", type=int, help="day number to take the slice of (default: today, UTC)")
    ap.add_argument("--limit", type=int, help="ask SteamCharts about at most this many games")
    ap.add_argument("--dry-run", action="store_true", help="fetch and report, write nothing")
    args = ap.parse_args(argv)

    games = load_main()
    for g in games:
        migrate_record(g)

    from_samples = raise_from_samples(games)
    print(f"{len(games)} games; all_time_peak raised from our own samples for {from_samples}")

    day = day_number() if args.day is None else args.day
    targets = games if args.all else [g for g in games if due(g, PEAK_CYCLE_DAYS, day)]
    if args.limit is not None:
        targets = targets[: args.limit]
    scope = "every game" if args.all else f"slice {day % PEAK_CYCLE_DAYS}/{PEAK_CYCLE_DAYS}"
    print(f"SteamCharts: {len(targets)} games ({scope})")

    tally = raise_from_steamcharts(targets, SteamChartsClient()) if targets else Counter()
    summary = ", ".join(f"{k} {v}" for k, v in tally.most_common()) or "nothing asked"
    print(f"\nSteamCharts: {summary}")

    if args.dry_run:
        print("Dry run: nothing written.")
        return
    save_main(games)
    print(f"✓ Saved {len(games)} games")


if __name__ == "__main__":
    main()
