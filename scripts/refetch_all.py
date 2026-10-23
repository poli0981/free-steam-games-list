#!/usr/bin/env python3
"""
Force re-fetch ALL games. MANUAL ONLY.
Backup → migrate → re-fetch each game from scratch → save.

At about six seconds a game the whole catalogue takes far longer than a job
may run, so it is done in parts: --part K/N takes the games whose
crc32(appid) % N is K-1 (core/rotation.py), and the workflow's runs queue
one behind another. Each game is cleared and fetched on a copy that replaces
it only once appdetails has answered, so a failed request - or the job
budget running out (core/budget.py) - leaves every other game exactly as it
was. The oldest last_updated goes first: running a part that was cut short
again carries on where it stopped.
"""
import argparse
import copy
import os
import re
import shutil
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.budget import Deadline
from core.constants import DATA_DIR, STEAM_API_KEY
from core.data_store import extract_appid, load_main, save_main, migrate_record
from core.fetcher import fetch_full, process_batch
from core.overrides import OverrideGuard
from core.rotation import slice_of
from core.steam_client import get_client

CLEARABLE = {
    "name", "description", "header_image",
    "developer", "publisher", "release_date",
    "reviews", "current_players", "peak_today", "metacritic",
    "drm_notes", "has_paid_dlc",
    "platforms", "languages", "language_details", "tags",
}
# Manual fields holding a scraper default rather than a decision: reset to the
# first value (the skeleton's), so the re-fetch fills them again. anti_cheat
# stays "-": it used to become "", which nothing else ever writes.
CONDITIONAL = {
    "genre":           ("", "N/A", "Uncategorized"),
    "anti_cheat":      ("-",),
    "anti_cheat_note": ("",),
    "is_kernel_ac":    (None,),
}
_LIST_FIELDS = {"developer", "publisher", "platforms", "languages", "language_details", "tags"}


def clear_fetchable(game):
    """Reset API-fetchable fields to empty. Preserves manual fields."""
    for f in CLEARABLE:
        if f in _LIST_FIELDS:
            game[f] = []
        elif f == "has_paid_dlc":
            game[f] = False
        else:
            game[f] = ""
    for f, defaults in CONDITIONAL.items():
        if game.get(f) in defaults:
            game[f] = defaults[0]
    game["reviews"] = "N/A"
    game["current_players"] = "N/A"
    game["peak_today"] = "N/A"
    game["metacritic"] = "N/A"


def parse_part(text: str) -> tuple[int, int]:
    """'K/N' -> (K, N) with 1 <= K <= N."""
    m = re.fullmatch(r"\s*(\d+)\s*/\s*(\d+)\s*", text or "")
    if not m or not 1 <= int(m.group(1)) <= int(m.group(2)):
        raise argparse.ArgumentTypeError(f"expected K/N with 1 <= K <= N, got {text!r}")
    return int(m.group(1)), int(m.group(2))


def in_part(game: dict, part: tuple[int, int]) -> bool:
    appid = extract_appid(game.get("link", ""))
    return bool(appid) and slice_of(appid, part[1]) == part[0] - 1


def refetch_one(game: dict, client, guard) -> bool:
    """Re-fetch one game from scratch, in place, or leave it exactly as it was
    when appdetails does not answer. Returns whether it was re-fetched."""
    appid = extract_appid(game.get("link", ""))
    if not appid:
        return False
    status, details = client.fetch_app_details_full(appid)
    if status != "ok" or not details:
        return False
    fresh = copy.deepcopy(game)
    clear_fetchable(fresh)
    fetch_full(fresh, client=client, prefetched_details=details, guard=guard)
    game.clear()
    game.update(fresh)
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    ap.add_argument("--part", type=parse_part, default=(1, 1),
                    help="K/N: re-fetch only the K-th of N parts of the catalogue (default 1/1)")
    args = ap.parse_args(argv)

    deadline = Deadline.from_env()
    games = load_main()
    if not games:
        print("Empty.")
        return
    targets = [g for g in games if in_part(g, args.part)]
    # Oldest first: a part cut short carries on where it stopped next time.
    targets.sort(key=lambda g: g.get("last_updated") or "")
    print(f"Force re-fetch: part {args.part[0]}/{args.part[1]}, {len(targets)} of {len(games)} games\n")

    backup_dir = DATA_DIR + ".bak"
    if os.path.isdir(backup_dir):
        shutil.rmtree(backup_dir)
    shutil.copytree(DATA_DIR, backup_dir)
    print(f"Backup -> {backup_dir}")

    for g in games:
        migrate_record(g)
    if not STEAM_API_KEY:
        print("⚠ No STEAM_API_KEY – players skipped")

    client = get_client()
    guard = OverrideGuard.load()
    tally: Counter = Counter()
    process_batch(targets, lambda g: tally.update([refetch_one(g, client, guard)]),
                  "Re-fetching", deadline=deadline)
    save_main(games)

    print(f"\n{'═'*50}")
    print(f"Re-fetched {tally[True]} of {len(targets)} ({tally[False]} left as they were: "
          f"appdetails did not answer). Backup: {backup_dir}")


if __name__ == "__main__":
    main()
