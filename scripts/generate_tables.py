import json
import os
import sys
from collections import defaultdict
from datetime import datetime

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from utils import short_desc, fancy_name
from steam_fetcher import extract_appid

# Read data.json (folder scripts/)
with open('scripts/data.json', 'r', encoding='utf-8') as f:
    games = json.load(f)

os.makedirs("games", exist_ok=True)

def review_scores(game):
    reviews = game.get('reviews', "N/A")
    if 'N/A' in reviews or "No reviews" in reviews:
        return 0
    try:
        percent = int(reviews.split('%')[0])
        return percent
    except ValueError:
        return 0

games.sort(key=review_scores, reverse=True) # Highest

genres = defaultdict(list)
for game in games:
    genre_key = game.get("genre", "Uncategorized")
    genres[genre_key].append(game)


# New Header
header = "| No. | Thumbnail | Game Name | Genre | Developer | Release Date | Short Desc | Steam Link | Reviews | Players | Anti-Cheat | Notes | Safe |\n"
header += "|-----|-----------|-----------|-------|-----------|--------------|------------|------------|---------|---------|------------|-------|------|\n"
updated_time = datetime.now().strftime("%Y-%m-%d %H:%M")

# All-games.md
with open("games/all-games.md", "w", encoding="utf-8") as f:
    f.write("# All Free-to-Play Games\n\n")
    f.write(f"Total: {len(games)} games – Updated: {updated_time} (full fresh API + noob notes :)) )\n\n")
    f.write(header)
    for i, game in enumerate(games, 1):
        name = game.get('name', f"Game {extract_appid(game['link']) or 'NoID'} – Check link bro")
        header_img = game.get('header_image', 'https://via.placeholder.com/460x215?text=No+Image')
        genre = game.get('genre', 'N/A')
        developer = game.get('developer', 'N/A')
        release_date = game.get('release_date', 'N/A')
        desc = short_desc(game.get('desc', 'N/A'))
        link = game['link']
        reviews = game.get('reviews', 'N/A')
        players = game.get('current_players', 'N/A')
        anti_cheat = game.get('anti_cheat', '-')
        notes = game.get('notes', "No review")
        safe = game.get('safe', '?')

        fancy = fancy_name(name)

        thumbnail = f"![{name}]({header_img})"

        row = f"| {i} | {thumbnail} | {fancy} | {genre} | {developer} | {release_date} | {desc} | [Link]({link}) | {reviews} | {players} | {anti_cheat} | {notes} | {safe} |\n"
        f.write(row)
        
# Genre files
for genre, game_list in genres.items():
    game_list.sort(key=review_scores, reverse=True)
    safe_name = genre.lower().replace(' ', '-').replace('/', '-').replace(',', '').replace('(', '').replace(')', '')
    with open(f'games/{safe_name}.md', 'w', encoding='utf-8') as f:
        f.write(f"# {genre} Games\n\n")
        f.write(f"{len(game_list)} games – Updated: {updated_time}\n\n")
        f.write(header)
    for i, game in enumerate(game_list, 1):
        name = game.get('name', f"Game {extract_appid(game['link']) or 'NoID'} – Check link bro")
        header_img = game.get('header_image', 'https://via.placeholder.com/460x215?text=No+Image')
        genre = game.get('genre', 'N/A')
        developer = game.get('developer', 'N/A')
        release_date = game.get('release_date', 'N/A')
        desc = short_desc(game.get('desc', 'N/A'))
        link = game['link']
        reviews = game.get('reviews', 'N/A')
        players = game.get('current_players', 'N/A')
        anti_cheat = game.get('anti_cheat', '-')
        notes = game.get('notes', "No review")
        safe = game.get('safe', '?')

        fancy = fancy_name(name)

        thumbnail = f"![{name}]({header_img})"

        row = f"| {i} | {thumbnail} | {fancy} | {genre} | {developer} | {release_date} | {desc} | [Link]({link}) | {reviews} | {players} | {anti_cheat} | {notes} | {safe} |\n"
        f.write(row)
