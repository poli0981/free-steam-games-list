#!/usr/bin/env python3
"""Migrate records to v2.2 schema. Idempotent."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.data_store import load_main, save_main, migrate_record

def main():
    games = load_main()
    if not games: print("Empty."); return
    print(f"Migrating {len(games)} records...")
    migrated = 0
    for g in games:
        old = set(g.keys())
        migrate_record(g)
        if set(g.keys()) - old: migrated += 1
    save_main(games)
    print(f"✓ {migrated} records updated. All {len(games)} now v2.2.")

if __name__ == "__main__": main()
