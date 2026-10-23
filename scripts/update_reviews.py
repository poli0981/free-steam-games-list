#!/usr/bin/env python3
"""
Refresh every game's review summary from Steam's own, a hundred-odd requests a day.

This used to ask store.steampowered.com/appreviews about one game at a time:
two seconds a game, five and a half hours at 9,800 games, and on 2026-10-23 it
ran into GitHub's six-hour limit and was stopped with nothing saved.
IStoreBrowseService/GetItems answers for fifty games a request with the summary
the store shows (core/store_items.review_summary): the whole catalogue in about
two minutes.

The rules:
  - A summary with reviews is written "85% (Very Positive)": Steam's floored
    percentage and its label, the vocabulary appreviews has ("3 user
    reviews", "Mixed").
  - A count of 0 is never written on GetItems' word alone: its summary has
    said 0 for a game with thousands of reviews. A game stored as "No
    reviews" stays so; one stored with a percentage, "N/A" or nothing is asked
    on appreviews instead (at most ASK_CAP a run, in an order that changes
    daily), and that answer is written, "No reviews" included.
  - No item, no usable summary, a failed batch or a failed appreviews request
    leaves the stored value alone. When GetItems answers for no game at all,
    nothing is written.
  - last_updated moves when the value changes, and on a heartbeat: a game
    whose summary was read and whose stamp is 14 to 20 days old (crc32
    jitter, so the stamps spread out) is stamped again. The site calls a
    record older than 30 days stale (web/src/lib/validation.ts, /health),
    and this job used to stamp every game on every run; the heartbeat keeps
    that meaning - read by the pipeline lately - without rewriting every
    record every day.
  - Everything is written by save_main().

Usage (from the repository root):
  python scripts/update_reviews.py
  python scripts/update_reviews.py --limit 200 --dry-run
"""
import argparse
import os
import sys
import zlib
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.budget import Deadline
from core.data_store import extract_appid, load_main, migrate_record, now_iso, save_main
from core.fetcher import process_batch, reviews_from_summary, reviews_text
from core.normalize import normalize_records
from core.rotation import daily_order, day_number
from core.steam_client import get_client
from core.store_items import review_summary

ASK_CAP = 300
HEARTBEAT_DAYS = 14
HEARTBEAT_JITTER_DAYS = 7
NO_REVIEWS = "No reviews"

# What decide() says to do with one game.
SET = "set"          # write this value
ASK = "ask"          # ask appreviews: GetItems said 0
KEEP = "keep"        # read, and nothing to write
UNKNOWN = "unknown"  # not read: no item or no usable summary


def decide(stored: str, item: Optional[dict]) -> tuple[str, Optional[str]]:
    """What GetItems' item says to do with a game whose reviews are `stored`."""
    found = review_summary(item)
    if found is None:
        return UNKNOWN, None
    count, pct, label = found
    if count > 0:
        return SET, reviews_text(count, pct, label)
    return (KEEP, None) if stored == NO_REVIEWS else (ASK, None)


def heartbeat_due(game: dict, now: datetime) -> bool:
    """Whether a game read today is due a new stamp although nothing changed:
    its last_updated is 14 to 20 days old (by its appid), or unreadable."""
    appid = extract_appid(game.get("link", "")) or ""
    days = HEARTBEAT_DAYS + zlib.crc32(appid.encode()) % HEARTBEAT_JITTER_DAYS
    try:
        stamp = datetime.strptime(game.get("last_updated") or "", "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return True
    return now - stamp.replace(tzinfo=timezone.utc) >= timedelta(days=days)


def record(game: dict, value: Optional[str], now: datetime, tally: Counter) -> None:
    """A game whose summary was read: write `value` (None: nothing new) and
    stamp it as the rules say."""
    if value is not None and game.get("reviews") != value:
        game["reviews"] = value
        game["last_updated"] = now_iso()
        tally["changed"] += 1
    elif heartbeat_due(game, now):
        game["last_updated"] = now_iso()
        tally["heartbeat"] += 1


def refresh(games: list[dict], client, deadline: Optional[Deadline] = None,
            day: Optional[int] = None, now: Optional[datetime] = None) -> Counter:
    """Refresh the reviews of `games` in place. Returns a tally: changed,
    heartbeat, unknown, unanswered (batches GetItems failed), asked,
    ask_failed, ask_skipped (over the cap or past the deadline), and
    no_answer when GetItems answered for nobody."""
    now = now or datetime.now(timezone.utc)
    by_id = {}
    for game in games:
        appid = extract_appid(game.get("link", ""))
        if appid:
            by_id[appid] = game
    items, failed = client.fetch_items(list(by_id), {"include_reviews": True})
    tally: Counter = Counter(unanswered=len(failed))
    if by_id and len(failed) == len(by_id):
        tally["no_answer"] = 1
        return tally

    asks: list[dict] = []
    for appid, game in by_id.items():
        if appid in failed:
            continue
        kind, value = decide(game.get("reviews", ""), items.get(appid))
        if kind == UNKNOWN:
            tally["unknown"] += 1
        elif kind == ASK:
            asks.append(game)
        else:
            record(game, value, now, tally)

    def ask(game: dict) -> None:
        summary = client.fetch_reviews(extract_appid(game["link"]))
        if summary is None:
            tally["ask_failed"] += 1
        else:
            record(game, reviews_from_summary(summary), now, tally)

    asks = daily_order(asks, day_number() if day is None else day)
    done = process_batch(asks[:ASK_CAP], ask, "Reviews from appreviews", deadline=deadline) if asks else 0
    tally["asked"] = done
    tally["ask_skipped"] = len(asks) - done
    return tally


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    ap.add_argument("--limit", type=int, help="at most this many games (for trying it out)")
    ap.add_argument("--dry-run", action="store_true", help="ask Steam and report, write nothing")
    args = ap.parse_args(argv)

    deadline = Deadline.from_env()
    games = load_main()
    for g in games:
        migrate_record(g)
    # Compared as stored, like the other refresh jobs.
    normalize_records(games)
    targets = games if args.limit is None else games[: args.limit]
    print(f"{len(games)} games; reading the review summaries of {len(targets)} from Steam")

    tally = refresh(targets, get_client(), deadline=deadline)
    if tally["no_answer"]:
        print("::warning::GetItems answered for no game: nothing written.")
        return
    print(f"\nReviews: {tally['changed']} changed, {tally['heartbeat']} re-stamped (heartbeat), "
          f"{tally['unknown']} without a usable summary; appreviews asked about {tally['asked']} "
          f"({tally['ask_failed']} failed, {tally['ask_skipped']} left for another day)")
    if tally["unanswered"]:
        print(f"::warning::GetItems did not answer for {tally['unanswered']} games; "
              f"they keep their reviews until the next run.")

    if args.dry_run:
        print("Dry run: nothing written.")
        return
    save_main(games)
    print(f"✓ Saved {len(games)} games")


if __name__ == "__main__":
    main()
