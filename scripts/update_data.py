import json
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from steam_fetcher import update_all

# Read data.json (folder scripts/)
with open('scripts/data.json', 'r', encoding='utf-8') as f:
    games = json.load(f)

update = update_all(games)

# Save data.json fresh
with open("scripts/data.json", "w", encoding="utf-8") as f:
    json.dump(games, f, indent=4, ensure_ascii=False)

print("Done. JSON file is updated.")
