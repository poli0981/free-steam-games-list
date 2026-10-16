#!/usr/bin/env python3
"""
Refresh every game's anti-cheat from what its developer declares on Steam. Daily.

core/anticheat.py explains where Steam shows the disclosure and the rule that
applies it. Each run:

  1. asks GetItems (IStoreBrowseService, keyless) for the disclosure of EVERY
     game, 50 at a time: about 160 requests, a minute and a half;
  2. reads the store page of a disclosed game only when GetItems leaves out its
     name - a developer's own wording, which Steam keeps to the page (PUBG's
     "KSS (Krafton Security Services)");
  3. applies the rule with Steam winning: an empty game is filled, and a value
     Steam contradicts (another product, the other kernel flag) is replaced.

The rules:
  - No disclosure never clears anything: Warframe, Overwatch 2 and NARAKA use
    an anti-cheat and declare none. A disclosure that names nothing, not even
    on the page, changes nothing either, and is listed.
  - An override wins (core/overrides.py) and is not fought: a field it covers
    is not written, and neither is a retired entry's value, which
    apply_overrides() would undo on every run.
  - A batch GetItems did not answer leaves its games alone: unknown, not "no
    disclosure". After ten failed batches in a row the rest is not asked and
    the run ends with a warning, not a failure; with no answer at all nothing
    is written.
  - last_updated moves only for a game whose fields changed, so a run that
    learns nothing writes byte-identical shards. Everything goes through
    save_main().

It runs at the end of the daily Refresh Store Data job (bash/refresh_store.sh)
and is committed on its own; that workflow's `only: anticheat` runs just this.

Usage (from the repository root):
  python scripts/refresh_anticheat.py                       every game
  python scripts/refresh_anticheat.py --appid 2507950 578080
  python scripts/refresh_anticheat.py --limit 50 --dry-run
"""
import argparse
import os
import sys
from collections import Counter
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.anticheat import FIELDS, apply_anti_cheat, combine, from_store_item, parse_page
from core.data_store import extract_appid, is_empty, load_main, migrate_record, now_iso, save_main
from core.normalize import normalize_records
from core.overrides import OverrideGuard
from core.steam_client import get_client

GIVE_UP_AFTER = 10   # failed GetItems batches in a row


def _kernel(value) -> str:
    return {True: "kernel", False: "not kernel"}.get(value, "kernel unknown")


def sweep(targets: list[dict], client, guard, log=print) -> tuple[Counter, list[str]]:
    """Apply Steam's disclosures to `targets` in place. Returns a tally -
    disclosed, none, unknown, pages, filled, replaced, updated, unnamed - and
    the unnamed games, as "appid name"."""
    by_id: dict[str, dict] = {}
    for game in targets:
        appid = extract_appid(game.get("link", ""))
        if appid:
            by_id[appid] = game
    items, failed = client.fetch_anticheat_items(list(by_id), give_up_after=GIVE_UP_AFTER)
    tally: Counter = Counter(unknown=len(failed))
    unnamed: list[str] = []

    for appid, game in by_id.items():
        if appid in failed:
            continue
        api = from_store_item(items.get(appid))
        if api is None:
            tally["none"] += 1
            continue
        tally["disclosed"] += 1
        found = api
        if not api.name:
            # GetItems keeps a developer's own wording to the page.
            tally["pages"] += 1
            status, page = client.fetch_store_page_full(appid)
            found = combine(api, parse_page(page) if status == "ok" else None)
        if not found.name:
            tally["unnamed"] += 1
            unnamed.append(f"{appid} {game.get('name', '')[:40]}")
            continue

        before = {f: game.get(f) for f in FIELDS}
        changed = apply_anti_cheat(game, found, replace=True, guard=guard)
        if not changed:
            continue
        game["last_updated"] = now_iso()
        if is_empty(before["anti_cheat"]):
            kind = "filled"
        elif "anti_cheat" in changed:
            kind = "replaced"
        else:
            kind = "updated"
        tally[kind] += 1
        log(f"  {appid} {game.get('name', '')[:40]}: {before['anti_cheat'] or '-'} "
            f"({_kernel(before['is_kernel_ac'])}) -> {game['anti_cheat']} "
            f"({_kernel(game.get('is_kernel_ac'))}) [{', '.join(changed)}]")
    return tally, unnamed


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    ap.add_argument("--appid", nargs="+", help="only these games")
    ap.add_argument("--limit", type=int, help="at most this many games (for trying it out)")
    ap.add_argument("--dry-run", action="store_true", help="ask Steam and report, write nothing")
    args = ap.parse_args(argv)

    games = load_main()
    for g in games:
        migrate_record(g)
    # Compared as stored, like refresh_store_data.py.
    normalize_records(games)

    targets = [g for g in games if extract_appid(g.get("link", ""))]
    if args.appid:
        wanted = {str(a) for a in args.appid}
        targets = [g for g in targets if extract_appid(g["link"]) in wanted]
    if args.limit is not None:
        targets = targets[: args.limit]
    print(f"{len(games)} games; asking Steam about the anti-cheat of {len(targets)}")
    if not targets:
        return

    tally, unnamed = sweep(targets, get_client(), OverrideGuard.load())
    print(f"\nSteam: {tally['disclosed']} disclose an anti-cheat, {tally['none']} declare none, "
          f"{tally['unknown']} unknown; {tally['pages']} store pages read")
    if tally["unknown"]:
        print(f"::warning::GetItems did not answer for {tally['unknown']} games; "
              f"they keep their values until the next run.")
    changed = tally["filled"] + tally["replaced"] + tally["updated"]
    print(f"Anti-cheat: {changed} games changed (filled {tally['filled']}, "
          f"replaced {tally['replaced']}, updated {tally['updated']})")
    if unnamed:
        print(f"{len(unnamed)} disclose an anti-cheat without naming it: {', '.join(unnamed)}")

    if args.dry_run:
        print("Dry run: nothing written.")
        return
    if tally["unknown"] == len(targets):
        print("Steam answered for no game: nothing written.")
        return
    save_main(games)
    print(f"✓ Saved {len(games)} games")


if __name__ == "__main__":
    main()
