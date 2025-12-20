import json
import os
from collections import defaultdict
from datetime import datetime

import requests


# Extract appid
def extract_appid(link):
    if "/app/" not in link:
        return None
    parts = link.split("/app/")[1]
    return parts.split("/")[0]


# API key từ env (Action friendly)
api_key = os.getenv("STEAM_API_KEY")
use_key = bool(api_key)
if use_key:
    print("Found STEAM_API_KEY – fetching players ngon")
else:
    print("No key – skip players")

# Skip genres rác
SKIP_GENRES = [
    "Free to Play",
    "Indie",
    "Casual",
    "Early Access",
    "Multiplayer",
    "Singleplayer",
    "Co-op",
    "Online Co-Op",
    "PvP",
    "Cross-Platform Multiplayer",
    "In-App Purchases",
    "Massively Multiplayer",
    "Competitive",
]

# Đọc data.json (đồng folder scripts/)
with open('data.json', 'r', encoding='utf-8') as f:
    games = json.load(f)

# Fetch + update selective
for idx, game in enumerate(games):
    appid = extract_appid(game["link"])
    if not appid:
        print(f"[{idx + 1}] Invalid link cho {game.get('name', 'Unknown')}")
        continue

    details_url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
    try:
        resp = requests.get(details_url, timeout=10)
        details = resp.json().get(appid, {})
        if details.get("success"):
            data = details["data"]
            # Name luôn fresh (hiếm khi sai)
            game["name"] = data.get("name", game.get("name", "Unknown"))

            # Desc: chỉ fetch nếu missing hoặc N/A
            if not game.get("desc") or game["desc"] in ["N/A", "No description", ""]:
                game["desc"] = (
                    data.get("short_description", "No description").strip() or "N/A"
                )

            # Genre: giữ manual nếu có
            if not game.get("genre") or game["genre"] in ["N/A", "", None]:
                genres_list = [g["description"] for g in data.get("genres", [])]
                filtered = [g for g in genres_list if g not in SKIP_GENRES]
                primary = (
                    filtered[0]
                    if filtered
                    else (genres_list[0] if genres_list else "Uncategorized")
                )
                game["genre"] = primary

            # Developer + Release Date luôn fresh
            game["developer"] = ", ".join(data.get("developers", ["N/A"]))
            game["release_date"] = data.get("release_date", {}).get("date", "N/A")

            # Anti-Cheat: chỉ set VAC nếu chưa có thủ công
            if not game.get("anti_cheat") or game["anti_cheat"] == "-":
                anti_cheat = "-"
                for cat in data.get("categories", []):
                    if cat.get("description") == "Valve Anti-Cheat enabled":
                        anti_cheat = "VAC"
                        break
                game["anti_cheat"] = anti_cheat

            # Check no longer free → append note nếu cần
            is_free = data.get("is_free", False)
            price_overview = data.get("price_overview", {})
            if price_overview:
                is_free = is_free or price_overview.get("initial", 1) == 0
            if not is_free and "notes" in game:
                if "(No longer free" not in game["notes"]:
                    game["notes"] += " (No longer free! Check price bro)"

            print(f"[{idx + 1}] Updated selective cho {game['name']}")
    except Exception as e:
        print(f"Error details {game.get('name', 'Unknown')}: {e}")

    # Reviews fresh
    reviews_url = f"https://store.steampowered.com/appreviews/{appid}?json=1&language=all&purchase_type=all"
    try:
        resp = requests.get(reviews_url, timeout=10)
        review_data = resp.json()
        if review_data.get("success") == 1:
            summary = review_data["query_summary"]
            total = summary["total_reviews"]
            positive = summary["total_positive"]
            if total > 0:
                percent = round((positive / total) * 100)
                game["reviews"] = f"{percent}% ({summary['review_score_desc']})"
            else:
                game["reviews"] = "No reviews"
        else:
            game["reviews"] = game.get("reviews", "N/A")
    except Exception as e:
        game["reviews"] = game.get("reviews", "N/A")

    # Current players if steam API key is entered
    if use_key:
        players_url = f"https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?key={api_key}&appid={appid}"
        try:
            resp = requests.get(players_url, timeout=10)
            players = resp.json()["response"].get("player_count", "Error")
            game["current_players"] = (
                f"{players:,}" if isinstance(players, int) else "N/A"
            )
        except Exception as e:
            game["current_players"] = "Error"

    # Auto default fields
    if not game.get("notes", "").strip():
        game["notes"] = "No play - Not review."
    if not game.get("safe"):
        game["safe"] = "?"

# Save data.json fresh
with open("data.json", "w", encoding="utf-8") as f:
    json.dump(games, f, indent=4, ensure_ascii=False)

os.makedirs("../games", exist_ok=True)

# Sort + group
games.sort(key=lambda x: x["name"].lower())
genres = defaultdict(list)
for game in games:
    genre_key = game.get("genre", "Uncategorized")
    genres[genre_key].append(game)

def fancy_truncate(name, max_len=40):  # 40 cho table đẹp
    if len(name) <= max_len:
        return name
    words = name.split()
    acronym = ''.join(w[0].upper() for w in words if w)
    if len(acronym) <= max_len - 5:
        return f"{acronym} ({name[:20]}...)"
    return name[:max_len-3] + '...'

def short_desc(full):
    if not full or full == 'N/A':
        return 'N/A'
    sentence = full.split('.')[0]
    return (sentence[:100] + '...') if len(sentence) > 100 else sentence

with open('../games/gallery.md', 'w', encoding='utf-8') as f:
    f.write("# Game Gallery\n\n")
    f.write("| No. | Game | Header Image |\n")
    f.write("|-----|------|-------------|\n")
    for i, game in enumerate(games, 1):
        row = f"| {i} | {fancy_truncate(game['name'])} | ![ {game['name']} ]({game['header_image']}&width=460) |\n"  # Resize Steam link
        f.write(row)

online_games = [g for g in games if any(kw in g.get('genre', '') + str(g.get('categories', '')) for kw in ['Multiplayer', 'PvP', 'Co-op', 'MMO', 'Online'])]
online_games.sort(key=lambda x: int(x.get('current_players', '0').replace(',', '') or 0), reverse=True)
with open('../games/top-online.md', 'w', encoding='utf-8') as f:
    f.write("# Top Online/Multiplayer Games\n\n")
    f.write(f"{len(online_games)} games – Updated: {datetime.now().strftime('%Y-%m-%d %H:%M')} | Status dựa players (có key mới "
            f"accurate)\n\n")
    header_top = "| No. | Game | Players | Status | Link |\n|-----|------|---------|--------|------|\n"
    f.write(header_top)
    for i, game in enumerate(online_games[:50], 1):  # Top 50 thôi
        players = int(game.get('current_players', '0').replace(',', '') or 0)
        if players > 100000:
            status = "Sống dai vl 🔥"
        elif players > 6000:
            status = "Sống tốt, chơi đông"
        elif players > 1000:
            status = "Còn thở, nhưng yếu"
        elif players > 100:
            status = "Dấu hiệu dead?"
        elif players > 10:
            status = "Sắp die :(("
        else:
            status = "Die forever rip"
        row = f"| {i} | {fancy_truncate(game['name'])} | {game.get('current_players', 'N/A')} | {status} | [Link]({game['link']}) |\n"
        f.write(row)

os.makedirs("../games", exist_ok=True)

# New Header
header = "| No. | Game Name | Genre | Developer | Release Date | Short Description | Steam Link | Reviews (Updated) | Current Players | Anti-Cheat | Notes | Safe |\n"
header += "|-----|-----------|-------|-----------|--------------|-------------------|------------|-------------------|-----------------|------------|-------|------|\n"

updated_time = datetime.now().strftime("%Y-%m-%d %H:%M")

# All-games.md
with open("../games/all-games.md", "w", encoding="utf-8") as f:
    f.write("# All Free-to-Play Games\n\n")
    f.write(
        f"Total: {len(games)} games – Updated: {updated_time} (full fresh API + noob notes :)) )\n\n"
    )
    f.write(header)
    for i, game in enumerate(games, 1):
        row = (f"| {i} |{fancy_truncate(game['name'])}| {game.get('genre', 'N/A')} | {game.get('developer', 'N/A')} |"
               f" {game.get('release_date', 'N/A')} | {short_desc(game.get('desc', 'N/A'))} | [Link]({game['link']}) | {game.get('reviews', 'N/A')} | {game.get('current_players', 'N/A')} | {game.get('anti_cheat', '-')} | {game.get('notes', '-')} | {game.get('safe', '?')} |\n")
        f.write(row)

# Trong script, sau all-games.md
with open('../games/gallery.md', 'w', encoding='utf-8') as f:
    f.write("# Game Gallery (Header Images)\n\n")
    f.write("Click ảnh để mở Steam page bro\n\n")
    for game in games:
        img = game.get('header_image', '')
        if img and img != 'N/A':
            f.write(f"### [{game['name']}]({game['link']})\n")
            f.write(f"![{game['name']}]({img} \"{game['name']}\")\n\n")  # Auto resize GitHub sẽ handle
        else:
            f.write(f"### {game['name']} - No image :(\n\n")

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
            row = (f"| {i} | {fancy_truncate(game['name'])} | {game.get('genre', 'N/A')} | {game.get('developer', 'N/A')} |"
                   f" {game.get('release_date', 'N/A')} | {short_desc(game.get('desc', 'N/A'))} | [Link]({game['link']}) | {game.get('reviews', 'N/A')} | {game.get('current_players', 'N/A')} | {game.get('anti_cheat', '-')} | {game.get('notes', '-')} | {game.get('safe', '?')} |\n")
            f.write(row)

print("Done.Successfully\n")

