import json
import os
from collections import defaultdict
from datetime import datetime
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from steam_fetcher import update_all
from utils import short_desc, fancy_name

# Read data.json (folder scripts/)
with open('data.json', 'r', encoding='utf-8') as f:
    games = json.load(f)

# Save data.json fresh
with open("data.json", "w", encoding="utf-8") as f:
    json.dump(games, f, indent=4, ensure_ascii=False)

os.makedirs("../games", exist_ok=True)

update = update_all(games)

# Sort + group
games.sort(key=lambda x: x["name"].lower())
genres = defaultdict(list)
for game in games:
    genre_key = game.get("genre", "Uncategorized")
    genres[genre_key].append(game)

os.makedirs("../games", exist_ok=True)

# New Header
header = "| No. | Thumbnail | Game Name | Genre | Developer | Release Date | Short Desc | Steam Link | Reviews | Players | Anti-Cheat | Notes | Safe |\n"
header += "|-----|-----------|-----------|-------|-----------|--------------|------------|------------|---------|---------|------------|-------|------|\n"
updated_time = datetime.now().strftime("%Y-%m-%d %H:%M")

# All-games.md
with open("../games/all-games.md", "w", encoding="utf-8") as f:
    f.write("# All Free-to-Play Games\n\n")
    f.write(
        f"Total: {len(games)} games – Updated: {updated_time} (full fresh API + noob notes :)) )\n\n"
    )
    f.write(header)
    for i, game in enumerate(games, 1):
        row = f"| {i} | ![{game['name']}]({game.get('header_image', '')}) | {fancy_name(game['name'])} | {game.get('genre', 'N/A')} | {game.get('developer', 'N/A')} | {game.get('release_date', 'N/A')} | {short_desc(game.get('desc', 'N/A'))} | [Link]({game['link']}) | {game.get('reviews', 'N/A')} | {game.get('current_players', 'N/A')} | {game.get('anti_cheat', '-')} | {game.get('notes', '-')} | {game.get('safe', '?')} |\n"
        f.write(row)

# Genre files
for genre, game_list in genres.items():
    game_list.sort(key=lambda x: x["name"].lower())
    safe_name = (
        genre.lower()
        .replace(" ", "-")
        .replace("/", "-")
        .replace(",", "")
        .replace("(", "")
        .replace(")", "")
    )

    with open(f"../games/{safe_name}.md", "w", encoding="utf-8") as f:
        f.write(f"# {genre} Games\n\n")
        f.write(f"{len(game_list)} games – Updated: {updated_time}\n\n")
        f.write(header)
        for i, game in enumerate(game_list, 1):
            row = f"| {i} | ![{game['name']}]({game.get('header_image', '')}) | {fancy_name(game['name'])} | {game.get('genre', 'N/A')} | {game.get('developer', 'N/A')} | {game.get('release_date', 'N/A')} | {short_desc(game.get('desc', 'N/A'))} | [Link]({game['link']}) | {game.get('reviews', 'N/A')} | {game.get('current_players', 'N/A')} | {game.get('anti_cheat', '-')} | {game.get('notes', '-')} | {game.get('safe', '?')} |\n"
            f.write(row)

print("Done.Successfully\n")