#!/usr/bin/env python3
"""TEMPORARY: sweep the historical free-to-play backlog by quarter or year.

>>> DELETE THIS SCRIPT, AND .github/workflows/backfill-discover.yml, ONCE THE
>>> BACKLOG HAS BEEN WORKED THROUGH. It exists only to catch up on titles
>>> released before the catalogue started tracking them, and has no ongoing
>>> purpose. scripts/discover_new.py covers everything from today forward.

Like discover_new.py this PROPOSES ONLY: it POSTs candidates to the Worker as
`pending` and can neither write data/ nor commit. The workflow grants it
`contents: read`.

How a window is found
---------------------
The store search is sorted Released_DESC, so offset IS the date axis: release
dates fall monotonically as `start` grows. Walking from page 0 to reach 2024
would burn ~90 page fetches before the first useful row, so instead the window's
first page is located by BINARY SEARCH over offsets (~8 fetches for a 130-page
catalogue), then walked forward until the dates fall out the far side.

The expensive part is enrich(): one throttled appdetails call per unknown
appid. That is the reason for windowing at all -- ~12,000 unknown appids at the
store throttle is several hours, far past a job timeout. One quarter is a
sitting most of the way through.

Language filter: fetch_search_page pins supportedlang=english, which is known to
exclude ~1,537 titles. That is deliberately left as-is so this sweep and the
daily one agree on what the catalogue is supposed to contain; widening it is a
separate decision, not a backfill detail.

Usage:
    python scripts/backfill_discover.py --year 2025 --quarter 3 --dry-run
    python scripts/backfill_discover.py --year 2024
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.steam_client import get_client
from discover_new import (
    PAGE_SIZE, POST_BATCH, catalogue_appids, enrich, parse_search_rows,
    safe_stdout, worker_get, worker_post,
)

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

# "10 Sep, 2026" and "Sep 10, 2026" both occur, sometimes on the same page.
_RE_DMY = re.compile(r"^(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s*(\d{4})$")
_RE_MDY = re.compile(r"^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s*(\d{4})$")
_RE_MY = re.compile(r"^([A-Za-z]{3})[a-z]*\s+(\d{4})$")
_RE_Y = re.compile(r"^(\d{4})$")


def parse_released(text):
    """(year, month), or None when the text is not a date.

    Day is dropped: quarter bucketing never needs it, and month-only strings
    ("Sep 2024") are common enough that carrying a day would mean inventing one.
    """
    t = (text or "").strip()
    m = _RE_DMY.match(t)
    if m:
        mon = MONTHS.get(m.group(2).lower())
        return (int(m.group(3)), mon) if mon else None
    m = _RE_MDY.match(t)
    if m:
        mon = MONTHS.get(m.group(1).lower())
        return (int(m.group(3)), mon) if mon else None
    m = _RE_MY.match(t)
    if m:
        mon = MONTHS.get(m.group(1).lower())
        return (int(m.group(2)), mon) if mon else None
    m = _RE_Y.match(t)
    if m:
        # Year-only rows sort with the year's start, so bucket them there.
        return (int(m.group(1)), 1)
    return None


def window_bounds(year, quarter):
    """(newest, oldest) inclusive (year, month) bounds."""
    if quarter:
        lo = (quarter - 1) * 3 + 1
        return (year, lo + 2), (year, lo)
    return (year, 12), (year, 1)


def fetch_page(client, page):
    """(rows, body) for a page index, or ([], None) on failure."""
    body = client.fetch_search_page(page * PAGE_SIZE, PAGE_SIZE)
    if not body:
        return [], None
    return parse_search_rows(body.get("results_html", "")), body


def page_date(rows):
    """First parseable (year, month) on the page, or None."""
    for _appid, _name, released in rows:
        ym = parse_released(released)
        if ym:
            return ym
    return None


def find_window_start(client, newest, total_pages):
    """Lowest page index whose dates have fallen to `newest` or older.

    Binary search is sound here only because the result set is sorted
    Released_DESC, so page_date() is non-increasing in the page index. A probe
    that yields no parseable date (an all-"Coming soon" page) cannot be
    compared, so it moves the low bound and is retried by the walk's own
    boundary rewind rather than being guessed at.
    """
    lo, hi, best = 0, total_pages - 1, 0
    probes = 0
    while lo <= hi:
        mid = (lo + hi) // 2
        rows, _ = fetch_page(client, mid)
        probes += 1
        ym = page_date(rows)
        if ym is None:
            lo = mid + 1
            continue
        if ym > newest:
            lo = mid + 1
        else:
            best = mid
            hi = mid - 1
    print(f"located window start at page {best} in {probes} probe(s)")
    # Rewind one page: the boundary row can sit anywhere inside `best - 1`.
    return max(0, best - 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--quarter", type=int, choices=[1, 2, 3, 4],
                    help="omit to sweep the whole year")
    ap.add_argument("--max-pages", type=int, default=40,
                    help="pages walked AFTER the window is located")
    ap.add_argument("--limit", type=int, default=250,
                    help="stop after this many candidates (bounds job runtime)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    safe_stdout()

    base = os.environ.get("WORKER_BASE_URL", "").strip()
    tid = os.environ.get("CF_ACCESS_CLIENT_ID", "").strip()
    tsec = os.environ.get("CF_ACCESS_CLIENT_SECRET", "").strip()
    if not args.dry_run and not (base and tid and tsec):
        print("ERROR: WORKER_BASE_URL, CF_ACCESS_CLIENT_ID and "
              "CF_ACCESS_CLIENT_SECRET are required (or use --dry-run)")
        return 2

    newest, oldest = window_bounds(args.year, args.quarter)
    label = f"{args.year}Q{args.quarter}" if args.quarter else str(args.year)
    print(f"window {label}: {oldest[0]}-{oldest[1]:02d} .. {newest[0]}-{newest[1]:02d}")

    known = catalogue_appids()
    print(f"catalogue: {len(known)} appids")

    if not args.dry_run:
        # Prove the credential before spending Steam requests.
        try:
            ping = worker_get(base, "/api/ingest/ping", tid, tsec)
            print(f"worker: reachable as {ping.get('actor')}")
            wk = worker_get(base, "/api/ingest/known", tid, tsec)
            known |= set(wk.get("appids") or [])
            print(f"worker: {wk.get('count')} already queued or decided")
        except Exception as e:
            print(f"ERROR: worker unreachable: {e}")
            return 2

    client = get_client()
    candidates, rejected, seen = [], {}, set()

    try:
        rows, body = fetch_page(client, 0)
        if not body:
            print("ERROR: first search page failed")
            return 1
        total = int(body.get("total_count") or 0)
        total_pages = max(1, -(-total // PAGE_SIZE))
        print(f"catalogue on Steam: {total} free games across {total_pages} pages")

        first = find_window_start(client, newest, total_pages)

        for page in range(first, min(first + args.max_pages, total_pages)):
            rows, _ = fetch_page(client, page)
            if not rows:
                print(f"page {page}: no rows, stopping")
                break

            in_window, past = [], False
            for appid, _name, released in rows:
                ym = parse_released(released)
                if ym is None:
                    continue          # "Coming soon", "To be announced", ...
                if ym > newest:
                    continue          # still newer than the window
                if ym < oldest:
                    past = True       # sorted DESC: everything below is older
                    continue
                if appid in seen:
                    continue          # paging drift
                seen.add(appid)
                if appid in known:
                    continue
                in_window.append(appid)

            print(f"page {page}: {len(rows)} rows, {len(in_window)} new in window")

            for appid in in_window:
                cand, reason = enrich(client, appid)
                if reason:
                    rejected[reason] = rejected.get(reason, 0) + 1
                    continue
                candidates.append(cand)
                if len(candidates) >= args.limit:
                    break

            if len(candidates) >= args.limit:
                print(f"stopping: hit --limit {args.limit}; re-run to continue "
                      f"(already-queued appids are skipped)")
                break
            if past:
                print("stopping: walked past the window")
                break
        else:
            print(f"stopping: hit --max-pages {args.max_pages}")
    finally:
        client.close()

    print(f"\ncandidates: {len(candidates)}")
    if rejected:
        print("rejected:", ", ".join(f"{k}={v}" for k, v in sorted(rejected.items())))

    if args.dry_run:
        for c in candidates[:20]:
            print(f"  {c.appid:>8}  {c.release_date:<14} {c.name[:50]}")
        if len(candidates) > 20:
            print(f"  ... and {len(candidates) - 20} more")
        return 0

    if not candidates:
        print("nothing to post")
        return 0

    posted = 0
    for i in range(0, len(candidates), POST_BATCH):
        chunk = candidates[i:i + POST_BATCH]
        res = worker_post(
            base, "/api/ingest/candidates",
            {"source": f"backfill:{label}"[:40],
             "candidates": [c.to_wire() for c in chunk]},
            tid, tsec,
        )
        posted += res.get("accepted", 0)
        for r in (res.get("rejected") or [])[:10]:
            print(f"  worker rejected {r.get('appid')}: {r.get('reason')}")
    print(f"posted: {posted} accepted")
    return 0


if __name__ == "__main__":
    sys.exit(main())
