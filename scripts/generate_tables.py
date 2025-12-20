import json
import os
from collections import defaultdict
from datetime import datetime

import requests

api_key = os.getenv('STEAM_API_KEY')
use_key = bool(api_key)
if use_key:
    print("Found STEAM_API_KEY – fetching current players is OK")
else:
    print("No STEAM_API_KEY found – skipping current players (file still run automatically)")

# Extract appid
def extract_appid(link):
    if "/app/" not in link:
        return None
    parts = link.split("/app/")[1]
    return parts.split("/")[0]

# skip genres
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

# Read data.json
with open("data.json", "r", encoding="utf-8") as f:
    games = json.load(f)

# Fetch + update info of the game
for idx, game in enumerate(games):
    appid = extract_appid(game["link"])
    if not appid:
        print(f"[{idx + 1}] Invalid link with {game.get('name', 'Unknown')}")
        continue

    # Fetch appdetails (public - update name/desc/genre/developer/release/anti-cheat/free check)
    details_url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
    try:
        resp = requests.get(details_url, timeout=10)
        details = resp.json().get(appid, {})
        if details.get("success"):
            data = details["data"]
            # Always fresh basics
            game["name"] = data.get("name", game.get("name", "Unknown"))
            game["desc"] = (
                data.get("short_description", "No description").strip() or "N/A"
            )

            # Genre: keep manual input, else auto primary (skip genres)
            if not game.get("genre") or game["genre"] in ["N/A", "", None]:
                genres_list = [g["description"] for g in data.get("genres", [])]
                filtered = [g for g in genres_list if g not in SKIP_GENRES]
                primary = (
                    filtered[0]
                    if filtered
                    else (genres_list[0] if genres_list else "Uncategorized")
                )
                game["genre"] = primary

            # New: Developer + Release Date + Anti-Cheat
            game["developer"] = ", ".join(data.get("developers", ["N/A"]))
            game["release_date"] = data.get("release_date", {}).get("date", "N/A")
            anti_cheat = "-"
            for cat in data.get("categories", []):
                if cat.get("description") == "Valve Anti-Cheat enabled":
                    anti_cheat = "VAC"
                    break
            game["anti_cheat"] = anti_cheat  # Can manual check cho EAC/etc.

            # Check no longer free
            is_free = data.get("is_free", False)
            price_overview = data.get("price_overview", {})
            if price_overview:
                is_free = is_free or price_overview.get("initial", 1) == 0
            if not is_free:
                game["notes"] = (
                    game.get("notes", "") + " (No longer free! Check price bro)"
                )

            print(f"[{idx + 1}] Updated full info of {game['name']}")
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
        game["notes"] = "Not play - No review."
    if not game.get("safe"):
        game["safe"] = "?"

# Save data.json fresh
with open("data.json", "w", encoding="utf-8") as f:
    json.dump(games, f, indent=4, ensure_ascii=False)

os.makedirs('../games', exist_ok=True)

# Sort + group
games.sort(key=lambda x: x["name"].lower())
genres = defaultdict(list)
for game in games:
    genre_key = game.get("genre", "Uncategorized")
    genres[genre_key].append(game)

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
        row = f"| {i} | {game['name']} | {game.get('genre', 'N/A')} | {game.get('developer', 'N/A')} | {game.get('release_date', 'N/A')} | {game.get('desc', 'N/A')} | [Link]({game['link']}) | {game.get('reviews', 'N/A')} | {game.get('current_players', 'N/A')} | {game.get('anti_cheat', '-')} | {game.get('notes', '-')} | {game.get('safe', '?')} |\n"
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
            row = f"| {i} | {game['name']} | {game.get('genre', 'N/A')} | {game.get('developer', 'N/A')} | {game.get('release_date', 'N/A')} | {game.get('desc', 'N/A')} | [Link]({game['link']}) | {game.get('reviews', 'N/A')} | {game.get('current_players', 'N/A')} | {game.get('anti_cheat', '-')} | {game.get('notes', '-')} | {game.get('safe', '?')} |\n"
            f.write(row)

print("Done.Successfully\n")
