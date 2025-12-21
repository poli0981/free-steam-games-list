import os
import random
import time

import requests

# API key từ env
api_key = os.getenv('STEAM_API_KEY')
use_key = bool(api_key)
if use_key:
    print("Found STEAM_API_KEY – sẽ fetch current players")
else:
    print("No key – skip players")

SKIP_GENRES = [
    'Free to Play', 'Indie', 'Casual', 'Early Access', 'Multiplayer', 'Singleplayer',
    'Co-op', 'Online Co-Op', 'PvP', 'Cross-Platform Multiplayer', 'In-App Purchases',
    'Massively Multiplayer', 'Competitive'
]

def extract_appid(link):
    if '/app/' not in link:
        return None
    parts = link.split('/app/')[1]
    return parts.split('/')[0]


def update_game(game):
    appid = extract_appid(game['link'])
    if not appid:
        print(f"Invalid link cho {game.get('name', 'Unknown')}")
        return game

    # Fetch details (public)
    details_url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
    try:
        resp = requests.get(details_url, timeout=10)
        details = resp.json().get(appid, {})
        if details.get('success'):
            data = details['data']
            # Name always fresh
            game['name'] = data.get('name', game.get('name', 'Unknown'))

            # Desc: fetch if missing
            if not game.get('desc') or game['desc'] in ['N/A', 'No description', '']:
                game['desc'] = data.get('short_description', 'No description').strip() or 'N/A'

            # Header image (thumbnail table)
            game['header_image'] = data.get('header_image', 'https://via.placeholder.com/460x215?text=No+Image')

            # Genre: keep manual if exist
            if not game.get('genre') or game['genre'] in ['N/A', '', None]:
                genres_list = [g['description'] for g in data.get('genres', [])]
                filtered = [g for g in genres_list if g not in SKIP_GENRES]
                primary = filtered[0] if filtered else (genres_list[0] if genres_list else 'Uncategorized')
                game['genre'] = primary

            # Developer + Release Date fresh
            game['developer'] = ', '.join(data.get('developers', ['N/A']))
            game['release_date'] = data.get('release_date', {}).get('date', 'N/A')

            # Anti-Cheat
            if not game.get('anti_cheat') or game['anti_cheat'] == '-':
                anti_cheat = "-"
                for cat in data.get('categories', []):
                    if cat.get('description') == "Valve Anti-Cheat enabled":
                        anti_cheat = "VAC"
                        break
                game['anti_cheat'] = anti_cheat

            # Free check → append note if needed
            is_free = data.get('is_free', False)
            price_overview = data.get('price_overview', {})
            if price_overview:
                is_free = is_free or price_overview.get('initial', 1) == 0
            if not is_free:
                if '(No longer free' not in game.get('notes', ''):
                    game['notes'] = game.get('notes', '') + ' (No longer free! Check price bro)'

    except Exception as e:
        print(f"Error details {game.get('name', 'Unknown')}: {e}")

    # Reviews fresh
    reviews_url = f"https://store.steampowered.com/appreviews/{appid}?json=1&language=all&purchase_type=all"
    try:
        resp = requests.get(reviews_url, timeout=10)
        review_data = resp.json()
        if review_data.get('success') == 1:
            summary = review_data['query_summary']
            total = summary['total_reviews']
            positive = summary['total_positive']
            if total > 0:
                percent = round((positive / total) * 100)
                game['reviews'] = f"{percent}% ({summary['review_score_desc']})"
            else:
                game['reviews'] = "No reviews"
    except Exception as e:
        print(f"Error reviews {game.get('name', 'Unknown')}: {e}")

    # Players if key entered
    if use_key:
        players_url = f"https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?key={api_key}&appid={appid}"
        try:
            resp = requests.get(players_url, timeout=10)
            players = resp.json()['response'].get('player_count', 'Error')
            game['current_players'] = f"{players:,}" if isinstance(players, int) else 'N/A'
        except Exception as e:
            game['current_players'] = 'Error'
            print(f"Error players {game.get('name', 'Unknown')}: {e}")

    # Notes + Safe default nếu missing
    if not game.get('notes', '').strip():
        game['notes'] = "Not play -> Nor eview."
    if not game.get('safe'):
        game['safe'] = "?"

    return game


def update_all(games):
    is_github_action = os.getenv('GITHUB_ACTIONS') == 'true'  # Detect Action env
    delay_min = 0.2 if is_github_action else 1.0
    delay_max = 0.8 if is_github_action else 3.0
    print(f"Starting update {len(games)} games... ", end='')
    if is_github_action:
        print(f"(GitHub Action mode: fast delay {delay_min}-{delay_max}s to avoid timeout 🔥)")
    else:
        print("(Local mode: slower delay for safety)")

    for idx, game in enumerate(games):
        print(f"[{idx + 1}/{len(games)}] Fetching {game.get('name', 'Unknown')}...", end=' ')
        update_game(game)
        print(f"Done! Players: {game.get('current_players', 'N/A')} | Reviews: {game.get('reviews', 'N/A')}")

        if idx < len(games) - 1:
            delay = random.uniform(delay_min, delay_max)
            print(f"Sleeping {delay:.2f}s to be nice to Steam...")
            time.sleep(delay)

    print("All done bro! Stats fresh vl 🔥")


# Export generate_tables to import
__all__ = ['update_all']
