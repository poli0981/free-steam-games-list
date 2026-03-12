"""
Full data update – fetches details, reviews, and player counts
for games with incomplete information.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.data_store import load_main, save_main
from core.fetcher import update_all_full


def main():
    games = load_main()
    print(f"Loaded {len(games)} games from data.jsonl")

    update_all_full(games)
    save_main(games)

    print(f"\n✓ Saved {len(games)} games to data.jsonl")


if __name__ == "__main__":
    main()
