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

A game whose tags, languages or language_details are EMPTY is in the page
group every day, first, until they are filled (at most MISSING_DAILY_CAP a
day). Those were the age-gated games: Steam answered the anonymous request
with its age check, and for an 'Adult Only' game that is a Sign In page no
cookie opens. fetcher.scrape_store_fields() now reads such a game from Steam's
JSON API instead; before it, they stayed empty forever.

The rules, because these fields were fill-if-empty until now:
  - A value is only ever replaced by a NON-EMPTY one. A failed request, an age
    gate, a delisted app or a changed page layout leaves the stored value alone.
  - MANUAL_FIELDS are never written (genre, type_game, anti_cheat, safe, ...),
    and neither is `notes`: health checks and "no longer free" belong to
    check_dead_links.py, purge_unhealthy.py and mark_dead_games.py.
  - has_paid_dlc is read only from a real store page - one with a language
    table or tags - or, for a gated game, from the prices of its DLC. An
    age-gate page has no DLC section and would read as False; when neither
    source can be read, the stored value stays.
  - Every value is compared as it will be STORED - the description truncated
    to DESCRIPTION_MAX, the release date in its one shape, names cleaned
    (core/normalize.py) - or every refresh would look like a change. The
    loaded records are normalised the same way before anything is compared.
  - last_updated moves only for a game whose data actually changed.
  - Everything is written by save_main(): overrides are re-imposed, and
    index.json changes only if the shard bytes did.

Usage (from the repository root):
  python scripts/refresh_store_data.py                  today's slices
  python scripts/refresh_store_data.py --only page      one group
  python scripts/refresh_store_data.py --day 20719      the slices of a given day
  python scripts/refresh_store_data.py --missing-only   only games with empty store fields
  python scripts/refresh_store_data.py --limit 5 --dry-run
"""
import argparse
import os
import sys
import zlib
from collections import Counter
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.data_store import (
    ELLIPSIS, extract_appid, is_empty, load_main, migrate_record, now_iso, save_main,
    truncate_description,
)
from core.fetcher import process_batch, scrape_store_fields
from core.normalize import (
    clean_list, clean_text, decode_entities, normalize_records, normalize_release_date,
)
# The rotation (crc32 slices) is shared with refresh_peaks.py.
from core.rotation import day_number, due
from core.steam_client import get_client

PAGE_CYCLE_DAYS = 7
DETAILS_CYCLE_DAYS = 30
# Games with empty store fields taken a day on top of the rotation. 25 on
# 2026-10-10; the cap is for the day something breaks for every game at once,
# so a two-hour job cannot turn into a whole-catalogue crawl.
MISSING_DAILY_CAP = 150

PAGE_FIELDS = ("tags", "languages", "language_details", "has_paid_dlc")
DETAILS_FIELDS = (
    "name", "header_image", "description", "developer", "publisher",
    "release_date", "platforms", "metacritic", "drm_notes",
)


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
    # None: the page was gated and the DLC prices could not be read either.
    if scraped.get("has_paid_dlc") is not None:
        _replace(game, "has_paid_dlc", bool(scraped["has_paid_dlc"]), changed)
    return changed


def details_values(data: dict) -> dict:
    """The appdetails fields this job refreshes, as they would be stored.
    A field Steam did not return (or returned empty) is simply absent."""
    out: dict = {}

    name = clean_text(data.get("name") or "")
    if name:
        out["name"] = name

    image = (data.get("header_image") or "").strip()
    if image:
        out["header_image"] = image

    # Steam escapes the blurb ("&quot;game&quot;"); decoded before it is cut,
    # as save_main() decodes before truncate_descriptions().
    blurb = clean_text(decode_entities((data.get("short_description") or "").strip()),
                       single_line=False)
    if blurb:
        out["description"] = truncate_description(blurb)

    for source, field in (("developers", "developer"), ("publishers", "publisher")):
        raw = data.get(source) or []
        if isinstance(raw, str):
            raw = [raw]
        values = clean_list([v for v in raw if isinstance(v, str)])
        if values:
            out[field] = values

    released = normalize_release_date(((data.get("release_date") or {}).get("date") or "").strip())
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


def _fuller_cut(stored, fresh: str) -> bool:
    """Whether `fresh` is the stored blurb, only cut off later.

    A blurb stored HTML-escaped was truncated while "&quot;" still took six
    characters; decoded, the same blurb fits further under DESCRIPTION_MAX.
    That is not news about the game, so it is written without counting as a
    change. Only a blurb that grew from the stored one passes; one the
    publisher rewrote is still a change.
    """
    if not isinstance(stored, str) or not stored.endswith(ELLIPSIS):
        return False
    stem = stored[:-1].rstrip()
    return bool(stem) and len(fresh) > len(stored) and fresh.startswith(stem)


def apply_app_details(game: dict, data: dict) -> list[str]:
    changed: list[str] = []
    for field, value in details_values(data).items():
        if field == "description" and _fuller_cut(game.get("description"), value):
            game["description"] = value
            continue
        _replace(game, field, value, changed)
    return changed


def refresh_game(game: dict, client, page: bool, details: bool) -> list[str]:
    """Refresh one game in place. Returns the fields that changed."""
    appid = extract_appid(game.get("link", ""))
    if not appid:
        return []
    changed: list[str] = []
    data = None
    if details:
        data = client.fetch_app_details(appid)
        if data:
            changed += apply_app_details(game, data)
    if page:
        # The appdetails just fetched spare the DLC check a second request.
        scraped = scrape_store_fields(client, appid, details=data)
        if scraped:
            changed += apply_store_page(game, scraped)
    if changed:
        game["last_updated"] = now_iso()
    return changed


# ──────────── The day's plan ────────────

def missing_store_fields(game: dict) -> bool:
    return any(is_empty(game.get(f)) for f in ("tags", "languages", "language_details"))


def build_plan(games: list[dict], day: int, want_page: bool = True,
               want_details: bool = True, missing_only: bool = False) -> list[tuple]:
    """[(game, page, details)] for one day: the games with empty store fields
    first (page group, every day), then the day's rotation slices.

    The repairs are capped at MISSING_DAILY_CAP and ordered by a hash that
    changes daily, so a residue Steam never fills cannot hold the same places
    forever. missing_only keeps just the repairs, store page only.
    """
    repairs: list[dict] = []
    if want_page:
        repairs = [g for g in games if missing_store_fields(g)]
        repairs.sort(key=lambda g: zlib.crc32(f"{day}:{extract_appid(g.get('link', ''))}".encode()))
        repairs = repairs[:MISSING_DAILY_CAP]
    if missing_only:
        return [(g, True, False) for g in repairs]

    plan = [(g, True, want_details and due(g, DETAILS_CYCLE_DAYS, day)) for g in repairs]
    taken = {id(g) for g in repairs}
    for g in games:
        if id(g) in taken:
            continue
        page = want_page and due(g, PAGE_CYCLE_DAYS, day)
        details = want_details and due(g, DETAILS_CYCLE_DAYS, day)
        if page or details:
            plan.append((g, page, details))
    return plan


# ──────────── Main ────────────

def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    ap.add_argument("--only", choices=("page", "details"), help="refresh one group only")
    ap.add_argument("--day", type=int, help="day number to take the slices of (default: today, UTC)")
    ap.add_argument("--limit", type=int, help="at most this many games (for trying it out)")
    ap.add_argument("--missing-only", action="store_true",
                    help="only the games with empty tags/languages (store page group)")
    ap.add_argument("--dry-run", action="store_true", help="fetch and report, write nothing")
    args = ap.parse_args(argv)

    day = day_number() if args.day is None else args.day
    games = load_main()
    for g in games:
        migrate_record(g)
    # Compare against values as they will be stored. Without this, the first
    # run after a representation rule changes would see "Point &amp; Click"
    # against "Point & Click" and count it as news for hundreds of games.
    normalize_records(games)

    want_page = args.only in (None, "page")
    want_details = args.only in (None, "details")
    plan = build_plan(games, day, want_page, want_details, missing_only=args.missing_only)
    if args.limit is not None:
        plan = plan[: args.limit]

    n_page = sum(1 for _, p, _ in plan if p)
    n_details = sum(1 for _, _, d in plan if d)
    n_missing = sum(1 for g, p, _ in plan if p and missing_store_fields(g))
    print(f"{len(games)} games; day {day}: store page for {n_page} "
          f"(slice {day % PAGE_CYCLE_DAYS}/{PAGE_CYCLE_DAYS}, {n_missing} with empty store fields), "
          f"appdetails for {n_details} (slice {day % DETAILS_CYCLE_DAYS}/{DETAILS_CYCLE_DAYS})")
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
