#!/usr/bin/env python3
"""
Apply data/blocklist.jsonl now: take every blocked game out of data/ and log it.

save_main() already leaves blocked games out of EVERY write, so any data job
would do this on its own. This script is what makes it happen promptly: the
"Ingest New Game Links" workflow runs it first whenever /admin (or
delete_game.py) commits to the blocklist, and on its three-hourly schedule.

It also heals the log: a blocked game that is no longer in data/ but has no
line in scripts/removed_games.jsonl gets one. That covers a removal applied by
a job whose commit left the log out. Every blocklist line was written for a game
the catalogue held at the time (/admin and delete_game.py both refuse
anything else), so each logged line describes a real removal.

  python scripts/remove_games.py                 # apply and log
  python scripts/remove_games.py --max-drop 900  # a deliberate mass removal

Run from the repository root (DATA_DIR is relative).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.blocklist import load_blocklist, removed_row
from core.constants import BLOCKLIST_JSONL, BLOCKLIST_MAX_DROP
from core.data_store import extract_appid, load_main, log_admin_removals, save_main


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-drop", type=int, default=BLOCKLIST_MAX_DROP,
                    help=f"refuse to remove more games than this in one run (default {BLOCKLIST_MAX_DROP})")
    args = ap.parse_args(argv)

    blocked = load_blocklist()
    if not blocked:
        print(f"{BLOCKLIST_JSONL}: nothing blocked.")
        return 0

    games = load_main()
    live = {extract_appid(g.get("link", "")) for g in games}
    present = sorted(a for a in blocked if a in live)

    if present:
        # save_main() does the removal and logs each game it leaves out.
        save_main(games, max_blocked_drop=args.max_drop)
        print(f"Removed {len(present)} blocked game(s) from data/: {', '.join(present[:20])}"
              + (" …" if len(present) > 20 else ""))
    else:
        print("No blocked game is in data/.")

    healed = log_admin_removals([removed_row(e) for a, e in blocked.items() if a not in live])
    if healed:
        print(f"Logged {healed} earlier removal(s) that were missing from scripts/removed_games.jsonl.")
    print(f"Blocklist: {len(blocked)} game(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
