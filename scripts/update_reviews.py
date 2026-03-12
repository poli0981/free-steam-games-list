"""
Update reviews only for all games.
Runs every 2 days via CI.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.data_store import load_main, save_main
from core.fetcher import update_reviews_only


def main():
    games = load_main()
    print(f"Loaded {len(games)} games – updating reviews...")

    update_reviews_only(games)
    save_main(games)

    print(f"\n✓ Reviews updated for {len(games)} games.")


if __name__ == "__main__":
    main()
