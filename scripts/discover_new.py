#!/usr/bin/env python3
"""Discover newly-released free-to-play games and propose them for review.

This script PROPOSES ONLY. It never writes to data/, never commits, and cannot
add a game to the catalogue: it POSTs candidates to the admin Worker, which
stores them as `pending` for a human to approve. That separation is the point —
discovery is automated, publication is not.

Deliberately NOT imported: anything that writes the dataset. See the CI guard in
.github/workflows/discover-new.yml.

Usage:
    python scripts/discover_new.py --mode daily
    python scripts/discover_new.py --mode daily --dry-run
"""
import argparse
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.data_store import load_main, extract_appid
from core.steam_client import get_client

# Steam caps the search page at 100 rows regardless of what we ask for.
PAGE_SIZE = 100
# A page spans roughly 11 days of releases at the current rate (~8-9/day), so
# five pages is about eight weeks of insurance. If the cron silently stops for a
# month, the next successful run still catches everything with no intervention.
DEFAULT_MAX_PAGES = 5
DEFAULT_STOP_AFTER_KNOWN = 2
# The Worker's own cap; batches larger than this are rejected.
POST_BATCH = 100

_RE_APPID = re.compile(r'data-ds-appid="([^"]+)"')
_RE_ROW = re.compile(r'<a[^>]*data-ds-appid="([^"]+)"[^>]*>(.*?)</a>', re.S)
_RE_TITLE = re.compile(r'<span class="title">(.*?)</span>', re.S)
# NOT `col search_released`: the live markup is
# `<div class="search_released responsive_secondrow">`. The `col ` prefix
# never matched, so every row came back with an empty date and the cheap
# "Coming soon" skip below silently never fired.
_RE_RELEASED = re.compile(r'<div class="search_released[^"]*">(.*?)</div>', re.S)
_RE_TAGS = re.compile(r"<[^>]+>")

# Types that are not games. `category1=998` already filters most of these out,
# but appdetails is the authoritative source and occasionally disagrees.
ALLOWED_TYPES = {"game"}


class Candidate:
    __slots__ = ("appid", "link", "name", "header_image", "release_date",
                 "app_type", "is_free", "payload")

    def __init__(self, appid, data):
        self.appid = appid
        self.link = f"https://store.steampowered.com/app/{appid}/"
        self.name = (data.get("name") or "")[:200]
        self.header_image = (data.get("header_image") or "")[:500]
        rd = data.get("release_date") or {}
        self.release_date = (rd.get("date") or "")[:60]
        self.app_type = (data.get("type") or "")[:30]
        self.is_free = bool(data.get("is_free"))
        self.payload = {
            "short_description": (data.get("short_description") or "")[:600],
            "genres": [g.get("description") for g in (data.get("genres") or [])][:12],
            "platforms": data.get("platforms") or {},
            "developers": (data.get("developers") or [])[:6],
            "publishers": (data.get("publishers") or [])[:6],
        }

    def to_wire(self):
        return {
            "appid": self.appid,
            "link": self.link,
            "name": self.name,
            "header_image": self.header_image,
            "release_date": self.release_date,
            "app_type": self.app_type,
            "is_free": self.is_free,
            "health_status": "ok",
            "payload": self.payload,
        }


def safe_stdout():
    """Stop a non-Latin game name from killing the run on a cp1252 console.

    Game names are publisher-controlled and routinely contain CJK, Cyrillic or
    emoji. On a Windows console that is a UnicodeEncodeError from print(), which
    aborts the sweep AFTER every Steam request has been paid for. GitHub runners
    are UTF-8 so this only bites locally -- which is exactly where the script is
    developed.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass


def parse_search_rows(results_html):
    """[(appid, name, released_text)] from one search page.

    Kept local rather than in core/scraper.py: that module is imported by
    fetcher.py, which drives every data-WRITING script, so a parsing bug there
    would break refetch_all/update_data/ingest_new. Here the blast radius is
    discovery only.
    """
    rows = []
    for appid, inner in _RE_ROW.findall(results_html):
        if "," in appid or not appid.isdigit():
            continue  # bundle/package id
        title_m = _RE_TITLE.search(inner)
        rel_m = _RE_RELEASED.search(inner)
        # Steam HTML-escapes titles: "Flip &amp; Shop" must not reach a review
        # screen (or a repo file) with the entity intact.
        name = html.unescape(_RE_TAGS.sub("", title_m.group(1)).strip()) if title_m else ""
        released = _RE_TAGS.sub("", rel_m.group(1)).strip() if rel_m else ""
        rows.append((appid, name, released))
    if not rows:
        # Fallback for a markup change: at least recover the appids so the sweep
        # degrades to "fetch details for everything" rather than silently
        # finding nothing.
        rows = [(a, "", "") for a in _RE_APPID.findall(results_html)
                if a.isdigit()]
    return rows


def catalogue_appids():
    """Appids already in data/."""
    out = set()
    for rec in load_main():
        aid = extract_appid(rec.get("link", ""))
        if aid:
            out.add(aid)
    return out


def worker_get(base, path, token_id, token_secret, timeout=30):
    req = urllib.request.Request(
        base.rstrip("/") + path,
        headers={
            "CF-Access-Client-Id": token_id,
            "CF-Access-Client-Secret": token_secret,
            "Accept": "application/json",
            "User-Agent": "f2p-discover",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        ctype = resp.headers.get("Content-Type", "")
        raw = resp.read()
        # An Access login redirect answers 200 with HTML. Treating that as
        # success is how a misconfigured token turns into a confusing parse
        # error twenty minutes into a sweep.
        if "application/json" not in ctype:
            raise RuntimeError(
                f"expected JSON from {path}, got {ctype or 'no content-type'} "
                f"(HTTP {resp.status}) - is the Access service token configured?"
            )
        return json.loads(raw)


def worker_post(base, path, payload, token_id, token_secret, timeout=60):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=body,
        headers={
            "CF-Access-Client-Id": token_id,
            "CF-Access-Client-Secret": token_secret,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "f2p-discover",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def enrich(client, appid):
    """(Candidate, None) or (None, reason). One appdetails call."""
    _, data = client.fetch_app_details_full(appid)
    if not data:
        return None, "no_data"
    if (data.get("type") or "") not in ALLOWED_TYPES:
        return None, f"type_{data.get('type') or 'unknown'}"
    if not data.get("is_free"):
        return None, "not_free"
    if (data.get("release_date") or {}).get("coming_soon"):
        return None, "coming_soon"
    return Candidate(appid, data), None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", choices=["daily"], default="daily")
    ap.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES)
    ap.add_argument("--stop-after-known-pages", type=int, default=DEFAULT_STOP_AFTER_KNOWN)
    ap.add_argument("--limit", type=int, default=0,
                    help="stop after this many candidates (0 = no limit)")
    ap.add_argument("--dry-run", action="store_true",
                    help="do everything except POST to the Worker")
    args = ap.parse_args()
    safe_stdout()

    base = os.environ.get("WORKER_BASE_URL", "").strip()
    tid = os.environ.get("CF_ACCESS_CLIENT_ID", "").strip()
    tsec = os.environ.get("CF_ACCESS_CLIENT_SECRET", "").strip()
    if not args.dry_run and not (base and tid and tsec):
        print("ERROR: WORKER_BASE_URL, CF_ACCESS_CLIENT_ID and "
              "CF_ACCESS_CLIENT_SECRET are required (or use --dry-run)")
        return 2

    known = catalogue_appids()
    print(f"catalogue: {len(known)} appids")

    if not args.dry_run:
        # Prove the credential BEFORE spending Steam requests.
        try:
            ping = worker_get(base, "/api/ingest/ping", tid, tsec)
            print(f"worker: reachable as {ping.get('actor')}")
        except Exception as e:
            print(f"ERROR: worker ping failed: {e}")
            return 2
        try:
            wk = worker_get(base, "/api/ingest/known", tid, tsec)
            queued = set(wk.get("appids") or [])
            print(f"worker: {len(queued)} appid(s) already queued or decided")
            # Counting these as known is what lets the stop rule fire; without
            # it yesterday's pending rows look new and every run walks to
            # --max-pages.
            known |= queued
        except Exception as e:
            print(f"ERROR: /api/ingest/known failed: {e}")
            return 2

    client = get_client()
    candidates, rejected, seen = [], {}, set()
    known_pages = 0

    try:
        for page in range(args.max_pages):
            start = page * PAGE_SIZE
            body = client.fetch_search_page(start, PAGE_SIZE)
            if not body:
                print(f"page {page}: search failed, stopping")
                break
            rows = parse_search_rows(body.get("results_html", ""))
            if not rows:
                print(f"page {page}: no rows, stopping")
                break

            unknown = []
            for appid, name, released in rows:
                if appid in seen:
                    continue  # paging drift: a mid-sweep release shifts rows down
                seen.add(appid)
                if appid in known:
                    continue
                if released.lower().startswith("coming"):
                    # Cheap local skip. The search text lags appdetails, so this
                    # is a this-run skip only, never a durable rejection.
                    rejected["coming_soon_search"] = rejected.get("coming_soon_search", 0) + 1
                    continue
                unknown.append(appid)

            print(f"page {page}: {len(rows)} rows, {len(unknown)} unknown")

            if not unknown:
                known_pages += 1
                if known_pages >= args.stop_after_known_pages:
                    print(f"stopping: {known_pages} consecutive pages fully known")
                    break
                continue
            known_pages = 0

            for appid in unknown:
                cand, reason = enrich(client, appid)
                if reason:
                    rejected[reason] = rejected.get(reason, 0) + 1
                    continue
                candidates.append(cand)
                if args.limit and len(candidates) >= args.limit:
                    print(f"stopping: hit --limit {args.limit}")
                    break
            if args.limit and len(candidates) >= args.limit:
                break
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
        try:
            res = worker_post(
                base, "/api/ingest/candidates",
                {"source": "discover", "candidates": [c.to_wire() for c in chunk]},
                tid, tsec,
            )
        except urllib.error.HTTPError as e:
            print(f"ERROR: POST failed {e.code}: {e.read()[:300]!r}")
            return 1
        posted += res.get("accepted", 0)
        for r in (res.get("rejected") or [])[:10]:
            print(f"  worker rejected {r.get('appid')}: {r.get('reason')}")
    print(f"posted: {posted} accepted")
    return 0


if __name__ == "__main__":
    sys.exit(main())
