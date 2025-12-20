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
    print("No STEAM_API_KEY found – skip fresh players, dùng data cũ (vẫn chạy nhưng không fresh)")
    exit()  # Hoặc continue với data cũ nếu muốn

def extract_appid(link):
    if '/app/' not in link:
        return None
    parts = link.split('/app/')[1]
    return parts.split('/')[0]

# Load data.json
with open('data.json', 'r', encoding='utf-8') as f:
    games = json.load(f)

# Filter online games (manual type_game)
online_games = [g for g in games if g.get('type_game', 'offline').lower() == 'online']

if not online_games:
    print("Not type_game = 'online' bro, check data.json :((")
    exit()

print(f"Found {len(online_games)} game online – fetching fresh players với key...")

# Fetch fresh players cho từng game online
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

    # Bonus: fetch genre fresh để confirm online vibe (nếu cần)
    details_url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
    try:
        resp = requests.get(details_url, timeout=10)
        details = resp.json().get(appid, {})
        if details.get('success'):
            data = details['data']
            genres_list = [g['description'] for g in data.get('genres', [])]
            if not any(kw.lower() in ' '.join(genres_list).lower() for kw in ['multiplayer', 'pvp', 'co-op', 'online', 'mmo']):
                game['notes'] = game.get('notes', '') + ' (Genre nghi offline? Check lại type_game)'
    except Exception as e:
        print(f"Error genre check cho {game['name']}: {e}")

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
    if count > 100000: return "Sống dai vl, đông như hội 🔥"
    if count > 6000: return "Sống tốt, đông vui"
    if count > 1000: return "Còn thở, chơi được"
    if count > 100: return "Sắp dead? Ít người vl"
    if count > 10: return "Die soon, ghost town"
    return "Dead forever RIP 💀"

# Generate top-online.md
updated_time = datetime.now().strftime('%Y-%m-%d %H:%M')
with open('../games/top-online.md', 'w', encoding='utf-8') as f:
    f.write("# Top Online/Multiplayer Games (Fresh Players)\n\n")
    f.write(f"Total online games: {len(online_games)} – Updated: {updated_time} (realtime từ Steam key :)) )\n\n")
    f.write("| Rank | Game | Players | Status | Genre | Notes | Link |\n")
    f.write("|------|------|---------|--------|-------|-------|------|\n")
    for rank, g in enumerate(online_games[:50], 1):  # Top 50 thôi bro
        status = player_status(player_count(g))
        f.write(f"| {rank} | {g['name']} | {g.get('current_players', 'N/A')} | {status} | {g.get('genre', 'N/A')} | {g.get('notes', '-')} | [Link]({g['link']}) |\n")

print("Done bro! Top online generated tại games/top-online.md 🔥 Add 'type_game': 'online' vào data.json cho game multi để lên bảng nha :))")
