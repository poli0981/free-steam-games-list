#!/usr/bin/env python3
"""
Take out the games that left the store, stopped being free or are not out yet. Daily.

A game is removed only when two of Steam's answers agree:

  1. the screen - IStoreBrowseService/GetItems for the whole catalogue, a
     hundred-odd requests (core/store_items.screen_item): Steam does not know
     the app, it is hidden or unlisted, coming soon, or has no is_free flag;
  2. the confirmation - appdetails for each flagged game, through the same
     check_game_health() the ingest uses. An "unavailable" (or 404) answer is
     asked again RECHECK_AFTER seconds later: appdetails has answered
     success:false for live games in bursts (14 of them on 2026-09-27).

This used to ask appdetails about every game, one at a time: 5.3 hours at
9,800 games, with one answer enough to remove one.

The rules:
  - A batch GetItems did not answer flags nothing, and neither does a network
    error at the confirmation: unknown is never "gone".
  - Blocklisted games are left to save_main(), which drops them anyway, and
    are not asked about.
  - More than --max-candidates flagged, or more than --max-removals confirmed,
    stops the run with an error BEFORE anything is written: that is a broken
    answer from Steam, not a wave of delistings.
  - Removals are logged to scripts/removed_games.jsonl as they always were
    (reason and status_code from core/health_checker.py): the Worker's
    reconcile reads that file.
  - Games removed in the past that GetItems now sees free, listed and released
    are listed in a ::notice::, so a removal Steam has since undone can be
    brought back by queueing its link again.

Usage (from the repository root):
  python scripts/purge_unhealthy.py
  python scripts/purge_unhealthy.py --dry-run
  python scripts/purge_unhealthy.py --max-removals 300    # a deliberate mass removal
"""
import argparse
import os
import sys
import time
from collections import Counter
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.blocklist import blocked_appids
from core.budget import Deadline, expired
from core.constants import REMOVED_JSONL
from core.data_store import (
    dedup_removed, extract_appid, load_jsonl, load_main, now_iso, save_jsonl, save_main,
)
from core.health_checker import (
    COMING_SOON, NOT_FOUND_404, NOT_FOUND_410, NOT_FREE, UNAVAILABLE, check_game_health,
)
from core.steam_client import get_client
from core.store_items import screen_item

MAX_CANDIDATES = 500
MAX_REMOVALS = 100
RECHECK_AFTER = 300        # seconds
SCREEN_REQUEST = {"include_release": True}
# appdetails answers worth asking twice: the ones a bad moment produces.
RECHECKED = frozenset({UNAVAILABLE, NOT_FOUND_404, NOT_FOUND_410})
# Removal reasons a game can come back from: what Steam says, not a person.
RECOVERABLE = frozenset({UNAVAILABLE, NOT_FOUND_404, NOT_FOUND_410, NOT_FREE, COMING_SOON})


def screen(games: list[dict], items: dict, failed: set, blocked: set) -> list[tuple[dict, str]]:
    """The games Steam's store flags, with why. A game without an appid is
    flagged too: check_game_health() calls its link invalid without a request."""
    out = []
    for game in games:
        appid = extract_appid(game.get("link", ""))
        if not appid:
            out.append((game, "invalid"))
        elif appid not in blocked and appid not in failed:
            why = screen_item(items.get(appid))
            if why:
                out.append((game, why))
    return out


def confirm(candidates: list[tuple[dict, str]], client, deadline: Optional[Deadline] = None,
            log=print) -> tuple[list, Counter]:
    """Ask appdetails about each flagged game. Returns ([(game, HealthResult)]
    to remove, tally). An unavailable answer is asked again RECHECK_AFTER
    seconds after the first ask; past the deadline nothing more is asked and
    the rest stay."""
    removals: list = []
    recheck: list[dict] = []
    tally: Counter = Counter()
    first_ask = None

    def judge(game: dict, result) -> None:
        if result.should_remove:
            removals.append((game, result))
        elif result.is_healthy:
            tally["kept"] += 1
            log(f"  ✓ kept {result.appid} {result.name[:40]}: appdetails says it is healthy")
        else:
            tally["network"] += 1

    for game, why in candidates:
        if expired(deadline):
            tally["unasked"] += 1
            continue
        first_ask = time.monotonic() if first_ask is None else first_ask
        result = check_game_health(game.get("link", ""), game.get("name", ""), client)
        if result.status in RECHECKED:
            recheck.append(game)
        else:
            judge(game, result)

    if recheck:
        wait = RECHECK_AFTER - (time.monotonic() - first_ask)
        if wait > 0:
            log(f"  {len(recheck)} answered as unavailable; asking again in {wait:.0f} s")
            time.sleep(wait)
        for game in recheck:
            if expired(deadline):
                tally["unasked"] += 1
                continue
            judge(game, check_game_health(game.get("link", ""), game.get("name", ""), client))
    return removals, tally


def recoverable(removed_rows: list[dict], live: set, blocked: set, client) -> list[str]:
    """Earlier removals Steam has since undone: "appid name" for each game
    removed for a store reason that GetItems now sees free, listed and
    released, and that is neither back in the catalogue nor blocklisted."""
    names: dict[str, str] = {}
    for row in removed_rows:
        appid = str(row.get("appid") or extract_appid(row.get("link", "")) or "")
        if appid and row.get("status_code") in RECOVERABLE and appid not in live | blocked:
            names[appid] = (row.get("name") or "").strip()
    if not names:
        return []
    items, failed = client.fetch_items(list(names), SCREEN_REQUEST)
    return [f"{a} {names[a]}".strip() for a in names
            if a not in failed and a in items and screen_item(items[a]) is None]


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip(),
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="screen and confirm, write nothing")
    ap.add_argument("--max-candidates", type=int, default=MAX_CANDIDATES,
                    help=f"stop when the screen flags more games than this (default {MAX_CANDIDATES})")
    ap.add_argument("--max-removals", type=int, default=MAX_REMOVALS,
                    help=f"stop when more games than this are confirmed (default {MAX_REMOVALS})")
    args = ap.parse_args(argv)

    deadline = Deadline.from_env()
    games = load_main()
    if not games:
        print("Empty.")
        return 0
    client = get_client()
    blocked = blocked_appids()
    ids = [a for a in (extract_appid(g.get("link", "")) for g in games) if a and a not in blocked]
    print(f"Screening {len(ids)} games with Steam's store API...")
    items, failed = client.fetch_items(ids, SCREEN_REQUEST)
    if ids and len(failed) == len(ids):
        print("::warning::GetItems answered for no game: nothing screened, nothing removed.")
        return 0
    if failed:
        print(f"::warning::GetItems did not answer for {len(failed)} games; they are screened again tomorrow.")

    candidates = screen(games, items, failed, blocked)
    flags = Counter(why for _, why in candidates)
    print(f"{len(candidates)} flagged: " + (", ".join(f"{k} {v}" for k, v in flags.most_common()) or "none"))
    if len(candidates) > args.max_candidates:
        print(f"::error::The screen flagged {len(candidates)} games, more than --max-candidates "
              f"{args.max_candidates}. That is a broken answer, not a wave of delistings: nothing "
              f"was asked or written. Run with a higher --max-candidates if it is real.")
        return 2

    removals, tally = confirm(candidates, client, deadline)
    for game, result in removals:
        print(f"  ❌ {result.appid} {(result.name or game.get('name', ''))[:50]} → {result.reason}")
    print(f"Confirmed {len(removals)}; kept {tally['kept']} that appdetails calls healthy, "
          f"{tally['network']} unanswered, {tally['unasked']} not asked (budget)")
    if len(removals) > args.max_removals:
        print(f"::error::{len(removals)} removals, more than --max-removals {args.max_removals}: "
              f"nothing written. Run with a higher --max-removals if they are real.")
        return 2

    back = recoverable(load_jsonl(REMOVED_JSONL), set(ids), blocked, client)
    if back:
        print(f"::notice::{len(back)} removed game(s) are free and on the store again: "
              f"{'; '.join(back[:20])}{' …' if len(back) > 20 else ''}. Queue a link in "
              f"scripts/temp_info.jsonl to bring one back.")

    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    if not removals:
        print("All healthy.")
        return 0
    gone = {id(game) for game, _ in removals}
    save_main([g for g in games if id(g) not in gone])
    log = [{"link": g.get("link", ""), "name": r.name or g.get("name", ""), "appid": r.appid or "",
            "reason": r.reason, "status_code": r.status, "removed_at": now_iso()}
           for g, r in removals]
    save_jsonl(REMOVED_JSONL, dedup_removed(load_jsonl(REMOVED_JSONL) + log))
    print(f"Purged {len(removals)}, remaining {len(games) - len(removals)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
