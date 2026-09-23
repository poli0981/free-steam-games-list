#!/usr/bin/env python3
"""
Refresh the store fields that nothing else ever refreshes. Daily, a slice at a time.

update_data.py only ENRICHES records that are incomplete, and fetcher.py's
apply_details() / apply_scraped() only fill EMPTY fields. So once a game has
its tags, languages, platforms, header image and the rest, nothing looks at
them again - short of refetch_all.py, which is manual and re-fetches all
~4,400 games in one sitting. Meanwhile Steam's user tags drift, games gain
localisations and paid DLC, a capsule image is replaced under a new ?t= stamp,
a "Coming soon" date becomes a real one.

Two groups, each on its own rotation, a slice of the catalogue per daily run:

  page      the store page: tags, languages, language_details,
            has_paid_dlc                                        every 7 days
  details   appdetails: name, header_image, description,
            developer, publisher, release_date, platforms,
            metacritic, drm_notes                               every 30 days

That is ~630 store pages and ~150 appdetails calls a day - about 40 minutes
at the client's throttle - instead of 8,800 requests in one run.

A game's slice is crc32(appid) % cycle, NOT appid % cycle: Steam appids are
overwhelmingly multiples of 10, so `% 30` would leave 27 of the 30 monthly
slices empty and pile the whole catalogue into the other three.

The rules, because these fields were fill-if-empty until now:
  - A value is only ever replaced by a NON-EMPTY one. A failed request, an age
    gate, a delisted app or a changed page layout leaves the stored value alone.
  - MANUAL_FIELDS are never written (genre, type_game, anti_cheat, safe, ...),
    and neither is `notes`: health checks and "no longer free" belong to
    check_dead_links.py, purge_unhealthy.py and mark_dead_games.py.
  - has_paid_dlc is read only from a real store page - one with a language
    table or tags. An age-gate page has no DLC section and would read as False.
  - `description` is compared as it will be STORED (truncated to
    DESCRIPTION_MAX), or every refresh would look like a change.
  - last_updated moves only for a game whose data actually changed.
  - Everything is written by save_main(): overrides are re-imposed, and
    index.json changes only if the shard bytes did.

Usage (from the repository root):
  python scripts/refresh_store_data.py                  today's slices
  python scripts/refresh_store_data.py --only page      one group
  python scripts/refresh_store_data.py --day 20719      the slices of a given day
  python scripts/refresh_store_data.py --limit 5 --dry-run
"""
import argparse
import os
import sys
import zlib
from collections import Counter
from datetime import date, datetime, timezone
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.data_store import (
    extract_appid, load_main, migrate_record, now_iso, save_main, truncate_description,
)
from core.fetcher import process_batch
from core.scraper import scrape_store_page
from core.steam_client import get_client

PAGE_CYCLE_DAYS = 7
DETAILS_CYCLE_DAYS = 30

PAGE_FIELDS = ("tags", "languages", "language_details", "has_paid_dlc")
DETAILS_FIELDS = (
    "name", "header_image", "description", "developer", "publisher",
    "release_date", "platforms", "metacritic", "drm_notes",
)


# ──────────── Rotation ────────────

def slice_of(appid: str, cycle: int) -> int:
    """The day of the cycle on which this game is refreshed. Stable forever:
    crc32 is fixed, so a game keeps its weekday and its day of the month."""
    return zlib.crc32(appid.encode("ascii")) % cycle


def day_number(today: Optional[date] = None) -> int:
    """Days since 1970-01-01, UTC. Consecutive runs walk through the slices."""
    today = today or datetime.now(timezone.utc).date()
    return (today - date(1970, 1, 1)).days


def due(game: dict, cycle: int, day: int) -> bool:
    appid = extract_appid(game.get("link", ""))
    return bool(appid) and slice_of(appid, cycle) == day % cycle


# ──────────── Applying fresh values ────────────

def _replace(game: dict, field: str, value, changed: list[str]) -> None:
    if game.get(field) != value:
        game[field] = value
        changed.append(field)


def apply_store_page(game: dict, scraped: dict) -> list[str]:
    """Replace the store-page fields with what the page says now.

    Returns the names of the fields that changed. A page with neither a
    language table nor a single tag is not a store page at all - an age gate,
    a redirect to the front page, a layout Steam changed - and changes nothing.
    """
    changed: list[str] = []
    languages = scraped.get("languages") or []
    details = scraped.get("language_details") or []
    tags = scraped.get("tags") or []
    if not languages and not tags:
        return changed
    if languages:
        _replace(game, "languages", languages, changed)
        if details:
            _replace(game, "language_details", details, changed)
    if tags:
        _replace(game, "tags", tags, changed)
    _replace(game, "has_paid_dlc", bool(scraped.get("has_paid_dlc")), changed)
    return changed


def details_values(data: dict) -> dict:
    """The appdetails fields this job refreshes, as they would be stored.
    A field Steam did not return (or returned empty) is simply absent."""
    out: dict = {}

    name = (data.get("name") or "").strip()
    if name:
        out["name"] = name

    image = (data.get("header_image") or "").strip()
    if image:
        out["header_image"] = image

    blurb = (data.get("short_description") or "").strip()
    if blurb:
        out["description"] = truncate_description(blurb)

    for source, field in (("developers", "developer"), ("publishers", "publisher")):
        raw = data.get(source) or []
        if isinstance(raw, str):
            raw = [raw]
        values = [v.strip() for v in raw if isinstance(v, str) and v.strip()]
        if values:
            out[field] = values

    released = ((data.get("release_date") or {}).get("date") or "").strip()
    if released:
        out["release_date"] = released

    flags = data.get("platforms") or {}
    platforms = [label for key, label in (("windows", "Windows"), ("mac", "macOS"), ("linux", "Linux"))
                 if flags.get(key)]
    if platforms:
        out["platforms"] = platforms

    score = (data.get("metacritic") or {}).get("score")
    if score:
        out["metacritic"] = str(score)

    # The same rule apply_details() uses, so a refresh and a first fetch agree.
    drm = [
        cat.get("description", "")
        for cat in data.get("categories", [])
        if "requires" in cat.get("description", "").lower()
        and "account" in cat.get("description", "").lower()
    ]
    if data.get("drm_notice"):
        drm.append(data["drm_notice"])
    out["drm_notes"] = "; ".join(drm[:2]) if drm else "None detected"
    return out


def apply_app_details(game: dict, data: dict) -> list[str]:
    changed: list[str] = []
    for field, value in details_values(data).items():
        _replace(game, field, value, changed)
    return changed


def refresh_game(game: dict, client, page: bool, details: bool) -> list[str]:
    """Refresh one game in place. Returns the fields that changed."""
    appid = extract_appid(game.get("link", ""))
    if not appid:
        return []
    changed: list[str] = []
    if details:
        data = client.fetch_app_details(appid)
        if data:
            changed += apply_app_details(game, data)
    if page:
        html = client.fetch_store_page(appid)
        if html:
            changed += apply_store_page(game, scrape_store_page(html))
    if changed:
        game["last_updated"] = now_iso()
    return changed


# ──────────── Main ────────────

def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    ap.add_argument("--only", choices=("page", "details"), help="refresh one group only")
    ap.add_argument("--day", type=int, help="day number to take the slices of (default: today, UTC)")
    ap.add_argument("--limit", type=int, help="at most this many games (for trying it out)")
    ap.add_argument("--dry-run", action="store_true", help="fetch and report, write nothing")
    args = ap.parse_args(argv)

    day = day_number() if args.day is None else args.day
    games = load_main()
    for g in games:
        migrate_record(g)

    want_page = args.only in (None, "page")
    want_details = args.only in (None, "details")
    plan = []
    for g in games:
        page = want_page and due(g, PAGE_CYCLE_DAYS, day)
        details = want_details and due(g, DETAILS_CYCLE_DAYS, day)
        if page or details:
            plan.append((g, page, details))
    if args.limit is not None:
        plan = plan[: args.limit]

    n_page = sum(1 for _, p, _ in plan if p)
    n_details = sum(1 for _, _, d in plan if d)
    print(f"{len(games)} games; day {day}: store page for {n_page} "
          f"(slice {day % PAGE_CYCLE_DAYS}/{PAGE_CYCLE_DAYS}), appdetails for {n_details} "
          f"(slice {day % DETAILS_CYCLE_DAYS}/{DETAILS_CYCLE_DAYS})")
    if not plan:
        return

    client = get_client()
    flags = {id(g): (page, details) for g, page, details in plan}
    fields: Counter = Counter()
    touched = 0

    def refresh(game: dict) -> None:
        nonlocal touched
        page, details = flags[id(game)]
        changed = refresh_game(game, client, page=page, details=details)
        if changed:
            touched += 1
            fields.update(changed)

    process_batch([g for g, _, _ in plan], refresh, "Refreshing")

    summary = ", ".join(f"{f} {n}" for f, n in fields.most_common()) or "nothing"
    print(f"\n{touched} of {len(plan)} games changed: {summary}")
    if args.dry_run:
        print("Dry run: nothing written.")
        return
    save_main(games)
    print(f"✓ Saved {len(games)} games")


if __name__ == "__main__":
    main()
