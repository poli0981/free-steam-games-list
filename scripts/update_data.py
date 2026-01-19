import jsonlines
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from steam_fetcher import update_all

# Read data.jsonl (folder scripts/)
with jsonlines.open('scripts/data.jsonl', 'r') as reader:
    games = list(reader)

update = update_all(games)

# Save data.jsonl fresh
with jsonlines.open('scripts/data.jsonl', 'w') as writer:
    for game in games:
        writer.write(game)

print("Done. JSON file is updated.")