import json
import os
import requests
import time
import random
from tqdm import tqdm
from datetime import datetime
# API key từ env (Action friendly)
api_key = os.getenv('STEAM_API_KEY')
use_key = bool(api_key)
if not use_key:
    print("No STEAM_API_KEY found – skip fresh players, use old data instead.")
    exit()  # Or continue with old data

def extract_appid(link):
    if '/app/' not in link:
        return None
    parts = link.split('/app/')[1]
    return parts.split('/')[0]

# Load data.json
with open('scripts/data.json', 'r', encoding='utf-8') as f:
    games = json.load(f)

# Filter online games (manual type_game)
online_games = [g for g in games if g.get('type_game', 'offline').lower() == 'online']

if not online_games:
    print("Not type_game = 'online' bro, check data.json :((")
    exit()

print(f"Found {len(online_games)} game online – fetching fresh players with key...")

# Fetch fresh players game online
for idx, game in enumerate(tqdm(online_games, desc="Fetching fresh players", unit="game")):
    appid = extract_appid(game['link'])
    if not appid:
        game['current_players'] = 'Invalid link'
        continue

    players_url = f"https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?key={api_key}&appid={appid}"
    try:
        resp = requests.get(players_url, timeout=10)
        players = resp.json()['response'].get('player_count', 'Error')
        game['current_players'] = f"{players:,}" if isinstance(players, int) else 'N/A'
    except Exception as e:
        game['current_players'] = 'Error'
        print(f"Error players cho {game['name']}: {e}")

    # Random delay
    if idx < len(online_games) - 1:
        delay = random.uniform(1, 3)
        time.sleep(delay)

# Sort by players descending
def player_count(g):
    p = g.get('current_players', '0').replace(',', '').replace('N/A', '0').replace('Error', '0')
    return int(p) if p.isdigit() else 0

online_games.sort(key=player_count, reverse=True)

# Player status vibe noob
def player_status(count):
    if count > 100000: return "Aged-game 🔥"
    if count > 6000: return "Good"
    if count > 1000: return "Decrease? Increase?"
    if count > 100: return "Signal dead?"
    if count > 10: return "Die soon, ghost town, server will close?"
    return "Dead forever RIP 💀"

# Generate top-online.md
updated_time = datetime.now().strftime('%Y-%m-%d %H:%M')
with open('games/top-online.md', 'w', encoding='utf-8') as f:
    f.write("# Top Online/Multiplayer Games (Fresh Players)\n\n")
    f.write(f"Total online games: {len(online_games)} – Updated: {updated_time} (realtime từ Steam key :)) )\n\n")
    f.write("| Rank | Game | Players | Status | Genre | Notes | Link |\n")
    f.write("|------|------|---------|--------|-------|-------|------|\n")
    for rank, g in enumerate(online_games[:50], 1):  # Top 50 games
        status = player_status(player_count(g))
        f.write(f"| {rank} | {g.get('name', 'N/A')} | {g.get('current_players', 'N/A')} | {status} | {g.get('genre', 'N/A')} | {g.get('notes', '-')} | [Link]({g['link']}) |\n")

print("Done bro! Top online generated at games/top-online.md")
