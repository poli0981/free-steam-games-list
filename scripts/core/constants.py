"""
Shared constants & configuration for the Steam F2P tracker.
"""
import os

# ──────────── Paths ────────────
DATA_JSONL       = "scripts/data.jsonl"
TEMP_JSONL       = "scripts/temp_info.jsonl"
DEAD_LINKS_LOG   = "scripts/dead_links.log"
GAMES_DIR        = "games"

# ──────────── Steam API ────────────
STEAM_API_KEY    = os.getenv("STEAM_API_KEY", "")
IS_CI            = os.getenv("GITHUB_ACTIONS") == "true"

STORE_API        = "https://store.steampowered.com/api/appdetails"
REVIEWS_API      = "https://store.steampowered.com/appreviews/{appid}?json=1&language=all&purchase_type=all"
PLAYERS_API      = "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/"
STORE_PAGE       = "https://store.steampowered.com/app/{appid}/"

# ──────────── Rate limiting ────────────
# Steam store API: ~200 requests / 5 min ≈ 1 req / 1.5s safe
# Steam Web API (with key): ~100k/day, generous but still throttle
STORE_DELAY_MIN  = 1.2 if IS_CI else 1.5
STORE_DELAY_MAX  = 2.0 if IS_CI else 3.0
API_DELAY_MIN    = 0.3 if IS_CI else 0.5
API_DELAY_MAX    = 0.8 if IS_CI else 1.2

# Pause between batches (seconds)
BATCH_SIZE       = 50
BATCH_PAUSE_MIN  = 15
BATCH_PAUSE_MAX  = 30

# Retry
MAX_RETRIES      = 3
RETRY_BACKOFF    = 2.0        # Exponential base
RETRY_429_WAIT   = 60         # Default wait on 429 if no Retry-After header

# ──────────── Genres to skip (tags, not real genres) ────────────
SKIP_GENRES = {
    "Free to Play", "Indie", "Casual", "Early Access", "Multiplayer",
    "Singleplayer", "Co-op", "Online Co-Op", "PvP",
    "Cross-Platform Multiplayer", "In-App Purchases",
    "Massively Multiplayer", "Competitive",
}

# ──────────── Table generation ────────────
MAX_GAMES_PER_FILE = 200
TOP_ONLINE_LIMIT   = 50
