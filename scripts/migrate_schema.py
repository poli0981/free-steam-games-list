#!/usr/bin/env python3
"""
Migrate data.jsonl records from v2.0 → v2.1 schema.

Adds missing fields (publisher, platforms, languages, tags, etc.)
and normalizes types (developer string → list).

Safe to run multiple times (idempotent).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.data_store import load_main, save_main, migrate_record


def main():
    games = load_main()
    if not games:
        print("data.jsonl is empty.")
        return

    print(f"Migrating {len(games)} records to v2.1 schema...")

    migrated = 0
    for game in games:
        old_keys = set(game.keys())
        migrate_record(game)
        new_keys = set(game.keys())
        if new_keys - old_keys:
            migrated += 1

    save_main(games)
    print(f"✓ Done. {migrated} records had new fields added.")
    print(f"  All {len(games)} records now have v2.1 schema.")


if __name__ == "__main__":
    main()
