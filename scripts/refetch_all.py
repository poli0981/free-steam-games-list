#!/usr/bin/env python3
"""
Force re-fetch ALL games. MANUAL ONLY.
Backup → migrate → clear fetchable → re-fetch → save.
"""
import sys, os, shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.constants import DATA_JSONL, STEAM_API_KEY
from core.data_store import load_main, save_main, migrate_record, now_iso
from core.fetcher import fetch_full, process_batch
from core.steam_client import get_client

CLEARABLE = {
    "name", "description", "header_image",
    "developer", "publisher", "release_date",
    "reviews", "current_players", "peak_today", "metacritic",
    "drm_notes", "has_paid_dlc",
    "platforms", "languages", "language_details", "tags",
}
CONDITIONAL = {
    "genre": ("", "N/A", "Uncategorized"),
    "anti_cheat": ("-",),
    "anti_cheat_note": ("",),
    "is_kernel_ac": (None,),
}
_LIST_FIELDS = {"developer", "publisher", "platforms", "languages", "language_details", "tags"}


def clear_fetchable(game):
    for f in CLEARABLE:
        if f in _LIST_FIELDS:
            game[f] = []
        elif f == "has_paid_dlc":
            game[f] = False
        else:
            game[f] = ""
    for f, defaults in CONDITIONAL.items():
        if game.get(f) in defaults:
            game[f] = defaults[0] if (isinstance(defaults[0], bool) or defaults[0] is None) else ""
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

    backup = DATA_JSONL + ".bak"
    shutil.copy2(DATA_JSONL, backup)
    print(f"✓ Backup → {backup}")

    # Migrate + clear
    for g in games:
        migrate_record(g)
        clear_fetchable(g)

    print(f"Cleared fetchable fields. Re-fetching...\n")
    if not STEAM_API_KEY:
        print("⚠ No STEAM_API_KEY – players skipped")

    client = get_client()
    process_batch(games, lambda g: fetch_full(g, client=client), "Re-fetching")

    stamp = now_iso()
    for g in games:
        g["last_updated"] = stamp
    save_main(games)

    # Stats
    has = lambda k: sum(1 for g in games if g.get(k) and g[k] not in ("", "N/A", [], False))
    print(f"\n{'═' * 50}")
    print(f"✓ {total} games saved. Backup: {backup}")
    print(f"  name: {has('name')} | dev: {has('developer')} | pub: {has('publisher')}")
    print(f"  plat: {has('platforms')} | lang: {has('languages')} | tags: {has('tags')}")


if __name__ == "__main__":
    main()
