import json
import os
from collections import defaultdict
from datetime import datetime

# Utils inline (short_desc + fancy_name – no module external)
def short_desc(full_desc):
    if not full_desc or full_desc == 'N/A':
        return 'N/A'
    sentence = full_desc.split('.')[0].strip()
    return sentence + '.' if sentence else full_desc[:100] + '...'

def fancy_name(name, max_len=50):
    if len(name) <= max_len:
        return name
    words = name.split()
    if len(words) > 5:
        abbr = ''.join(w[0].upper() for w in words if w)
        return f"{name[:30]}... ({abbr})"
    return name[:47] + '...'

def extract_appid(link):  # Fallback name nếu missing
    if '/app/' not in link:
        return 'NoID'
    parts = link.split('/app/')[1]
    return parts.split('/')[0]

# Load data.json
with open('data.json', 'r', encoding='utf-8') as f:
    games = json.load(f)

print(f"Loaded {len(games)} games from data.json – generating tables only (no fetch) 🔥")

def review_score(game):
    reviews = game.get('reviews', 'N/A')
    if 'N/A' in reviews or 'No reviews' in reviews:
        return 0
    try:
        return int(reviews.split('%')[0])
    except:
        return 0

games.sort(key=review_score, reverse=True)

# Group by genre
genres = defaultdict(list)
for game in games:
    genre_key = game.get('genre', 'Uncategorized')
    genres[genre_key].append(game)

# Header table
header = "| No. | Thumbnail | Game Name | Genre | Developer | Release Date | Short Desc | Steam Link | Reviews | Players | Anti-Cheat | Notes | Safe |\n"
header += "|-----|-----------|-----------|-------|-----------|--------------|------------|------------|---------|---------|------------|-------|------|\n"

updated_time = datetime.now().strftime('%Y-%m-%d %H:%M')

os.makedirs('../games', exist_ok=True)

# All-games.md – build content list safe
content = []
content.append("# All Free-to-Play Games\n\n")
content.append(f"Total: {len(games)} games")
content.append(f"– Generated: {updated_time} (from data.json – noob curated :)) )\n\n")
content.append(header)

for i, game in enumerate(games, 1):
    name = game.get('name', f"Game {extract_appid(game.get('link', ''))} – Check link bro")
    header_img = game.get('header_image', 'https://via.placeholder.com/460x215?text=No+Image')
    thumbnail = f"![{name}]({header_img})"
    fancy = fancy_name(name)

    row_parts = [
        str(i),
        thumbnail,
        fancy,
        game.get('genre', 'N/A'),
        game.get('developer', 'N/A'),
        game.get('release_date', 'N/A'),
        short_desc(game.get('desc', 'N/A')),
        f"[Link]({game.get('link', '#')})",
        game.get('reviews', 'N/A'),
        game.get('current_players', 'N/A'),
        game.get('anti_cheat', '-'),
        game.get('notes', "No review"),
        game.get('safe', '?')
    ]
    content.append("| " + " | ".join(row_parts) + " |\n")

with open('games/all-games.md', 'w', encoding='utf-8') as f:
    f.write(''.join(content))

# Genre files
for genre, game_list in genres.items():
    game_list.sort(key=review_score, reverse=True)
    safe_name = genre.lower().replace(' ', '-').replace('/', '-').replace(',', '')
    content = []
    content.append(f"# {genre} Games\n\n")
    content.append(f"{len(game_list)} games – Generated: {updated_time}\n\n")
    content.append(header)
    for i, game in enumerate(game_list, 1):
        name = game.get('name', f"Game {extract_appid(game.get('link', ''))} – Check link bro")
        header_img = game.get('header_image', 'https://via.placeholder.com/460x215?text=No+Image')
        thumbnail = f"![{name}]({header_img})"
        fancy = fancy_name(name)
        row_parts = [
            str(i),
            thumbnail,
            fancy,
            game.get('genre', 'N/A'),
            game.get('developer', 'N/A'),
            game.get('release_date', 'N/A'),
            short_desc(game.get('desc', 'N/A')),
            f"[Link]({game.get('link', '#')})",
            game.get('reviews', 'N/A'),
            game.get('current_players', 'N/A'),
            game.get('anti_cheat', '-'),
            game.get('notes', "No review"),
            game.get('safe', '?')
        ]

    with open(f'games/{safe_name}.md', 'w', encoding='utf-8') as f:
        f.write(''.join(content))

print("Tables generated bro! No fetch, pure JSON read – safe & fast 🔥")
