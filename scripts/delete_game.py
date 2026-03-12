"""
Delete a game from data.jsonl by link or appid.
Interactive CLI tool.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.data_store import load_main, save_main, extract_appid, normalize_link


def main():
    games = load_main()
    if not games:
        print("data.jsonl is empty or missing.")
        return

    print(f"Loaded {len(games)} games.")
    query = input("Enter Steam link, appid, or game name to search: ").strip()
    if not query:
        return

    # Try matching by link/appid first
    norm = normalize_link(query)
    target_appid = extract_appid(norm) if norm else (query if query.isdigit() else None)

    matches = []
    for i, g in enumerate(games):
        gid = extract_appid(g.get("link", ""))
        if target_appid and gid == target_appid:
            matches.append((i, g))
        elif query.lower() in g.get("name", "").lower():
            matches.append((i, g))

    if not matches:
        print("No games found matching your query.")
        return

    print(f"\nFound {len(matches)} match(es):\n")
    for idx, (i, g) in enumerate(matches, 1):
        print(f"  {idx}. {g.get('name', 'Unknown')} ({g.get('link', '?')})")

    choice = input(f"\nDelete which? (1-{len(matches)}, or 'all', or 'q' to quit): ").strip()
    if choice.lower() == "q":
        return

    to_delete = set()
    if choice.lower() == "all":
        to_delete = {i for i, _ in matches}
    elif choice.isdigit() and 1 <= int(choice) <= len(matches):
        to_delete = {matches[int(choice) - 1][0]}
    else:
        print("Invalid choice.")
        return

    confirm = input(f"Confirm delete {len(to_delete)} game(s)? (y/n): ").strip().lower()
    if confirm != "y":
        print("Cancelled.")
        return

    games = [g for i, g in enumerate(games) if i not in to_delete]
    save_main(games)
    print(f"✓ Deleted {len(to_delete)} game(s). {len(games)} remaining.")


if __name__ == "__main__":
    main()
