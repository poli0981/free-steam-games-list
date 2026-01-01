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


def fancy_name(game_name, max_len=50):
    if len(game_name) <= max_len:
        return game_name
    words = game_name.split()
    if len(words) > 5:
        abbr = ''.join(w[0].upper() for w in words if w)
        return f"{game_name[:30]}... ({abbr})"
    return game_name[:47] + '...'


def extract_appid(link):  # Fallback name if missing
    if '/app/' not in link:
        return 'NoID'
    parts = link.split('/app/')[1]
    return parts.split('/')[0]


# Load data.json
with open('scripts/data.json', 'r', encoding='utf-8') as f:
    games = json.load(f)

print(f"Loaded {len(games)} games from data.json – generating tables only (no fetch) 🔥")


def review_score(game_data):
    reviews = game_data.get('reviews', 'N/A')
    if 'N/A' in reviews or 'No reviews' in reviews:
        return 0
    try:
        return int(reviews.split('%')[0])
    except ValueError:
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

os.makedirs('games', exist_ok=True)


def generate_table_row(index, game_entry):
    name = game_entry.get('name', f"Game {extract_appid(game_entry.get('link', ''))} – Check link bro")
    header_img = game_entry.get('header_image', 'https://via.placeholder.com/460x215?text=No+Image')
    thumbnail = f"![{name}]({header_img})"
    fancy = fancy_name(name)

    row_parts = [
        str(index),
        thumbnail,
        fancy,
        game_entry.get('genre', 'N/A'),
        game_entry.get('developer', 'N/A'),
        game_entry.get('release_date', 'N/A'),
        short_desc(game_entry.get('desc', 'N/A')),
        f"[Link]({game_entry.get('link', '#')})",
        game_entry.get('reviews', 'N/A'),
        game_entry.get('current_players', 'N/A'),
        game_entry.get('anti_cheat', '-'),
        game_entry.get('notes', "No review"),
        game_entry.get('safe', '?')
    ]
    return "| " + " | ".join(row_parts) + " |\n"


# All-games.md – build content list safe
MAX_PER_FILE = 200
total_games = len(games)
num_files = (total_games // MAX_PER_FILE) + (1 if total_games % MAX_PER_FILE else 0)

for part in range(1, num_files + 1):
    start = (part - 1) * MAX_PER_FILE
    end = min(part * MAX_PER_FILE, total_games)
    part_games = games[start:end]

    content = [
        "# All Free-to-Play Games (Part {} of {})\n\n".format(part, num_files),
        f"Games {start + 1}-{end} of {total_games} – Generated: {updated_time}\n\n",
        header
    ]

    for i, game in enumerate(part_games, start + 1):
        content.append(generate_table_row(i, game))

    # FIX
    filename = f'all-games_part{part}.md' if num_files > 1 else 'all-games.md'
    with open(f'games/{filename}', 'w', encoding='utf-8') as f:
        f.write(''.join(content))

# Genre files
for genre, game_list in genres.items():
    game_list.sort(key=review_score, reverse=True)
    safe_name = genre.lower().replace(' ', '-').replace('/', '-').replace(',', '')
    content = [
        f"# {genre} Games\n\n",
        f"{len(game_list)} games – Generated: {updated_time}\n\n",
        header
    ]
    for i, game in enumerate(game_list, 1):
        content.append(generate_table_row(i, game))

    with open(f'games/{safe_name}.md', 'w', encoding='utf-8') as f:
        f.write(''.join(content))

print("Tables generated bro! No fetch, pure JSON read – safe & fast 🔥")
