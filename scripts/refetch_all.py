#!/usr/bin/env python3
"""
Force re-fetch ALL games. MANUAL ONLY.
Backup → migrate → clear fetchable → re-fetch → save.
"""
import sys, os, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.constants import DATA_DIR, STEAM_API_KEY
from core.data_store import load_main, save_main, migrate_record, now_iso
from core.fetcher import fetch_full, process_batch
from core.overrides import OverrideGuard
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


def main():
    games = load_main()
    if not games:
        print("Empty.")
        return
    total = len(games)
    print(f"Force re-fetch: {total} games\n")

    backup_dir = DATA_DIR + ".bak"
    if os.path.isdir(backup_dir):
        shutil.rmtree(backup_dir)
    shutil.copytree(DATA_DIR, backup_dir)
    print(f"Backup -> {backup_dir}")

    # Migrate + clear
    for g in games:
        migrate_record(g)
        clear_fetchable(g)

    print(f"Cleared fetchable fields. Re-fetching...\n")
    if not STEAM_API_KEY:
        print("⚠ No STEAM_API_KEY – players skipped")

    client = get_client()
    guard = OverrideGuard.load()
    process_batch(games, lambda g: fetch_full(g, client=client, guard=guard), "Re-fetching")

    stamp = now_iso()
    for g in games:
        g["last_updated"] = stamp
    save_main(games)

    # Stats
    has = lambda k: sum(1 for g in games if g.get(k) and g[k] not in ("", "N/A", [], False))
    print(f"\n{'═'*50}")
    print(f"Done {total} games. Backup: {backup_dir}")
    print(f"  name: {has('name')} | dev: {has('developer')} | pub: {has('publisher')}")
    print(f"  plat: {has('platforms')} | lang: {has('languages')} | tags: {has('tags')}")


if __name__ == "__main__":
    main()
