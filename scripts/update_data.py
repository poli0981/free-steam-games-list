#!/usr/bin/env python3
"""Full data update – enriches games with incomplete info."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.data_store import load_main, save_main, migrate_record
from core.fetcher import update_all_full

def main():
    games = load_main()
    print(f"Loaded {len(games)} games")
    # Auto-migrate on load
    for g in games: migrate_record(g)
    update_all_full(games)
    save_main(games)
    print(f"\n✓ Saved {len(games)} games")

if __name__ == "__main__": main()
