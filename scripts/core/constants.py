"""
Shared constants & configuration – v2.2
"""
import os

# ──────────── Paths ────────────
DATA_DIR       = "data"
LEGACY_JSONL   = "scripts/data.jsonl"      # fallback pre-migration
TEMP_JSONL     = "scripts/temp_info.jsonl"
DEAD_LINKS_LOG = "scripts/dead_links.log"
REMOVED_JSONL  = "scripts/removed_games.jsonl"
GAMES_DIR      = "games"

# ──────────── Sharding ────────────
MAX_RECORDS_PER_FILE = 800
SHARD_PREFIX         = "data_"

# ──────────── Steam API ────────────
STEAM_API_KEY  = os.getenv("STEAM_API_KEY", "")
IS_CI          = os.getenv("GITHUB_ACTIONS") == "true"

# ──────────── Rate limiting ────────────
STORE_DELAY_MIN = 1.2 if IS_CI else 1.5
STORE_DELAY_MAX = 2.0 if IS_CI else 3.0
API_DELAY_MIN   = 0.3 if IS_CI else 0.5
API_DELAY_MAX   = 0.8 if IS_CI else 1.2

BATCH_SIZE      = 50
BATCH_PAUSE_MIN = 15
BATCH_PAUSE_MAX = 30

MAX_RETRIES     = 3
RETRY_BACKOFF   = 2.0
RETRY_429_WAIT  = 60

# ──────────── Genre tag filter ────────────
SKIP_GENRE_TAGS = frozenset({
    "Free to Play", "Indie", "Casual", "Early Access", "Multiplayer",
    "Singleplayer", "Co-op", "Online Co-Op", "PvP",
    "Cross-Platform Multiplayer", "In-App Purchases",
    "Massively Multiplayer", "Competitive",
})

# ──────────── Anti-Cheat patterns ────────────
ANTI_CHEAT_PATTERNS: dict[str, list[str]] = {
    "VAC":        ["valve anti-cheat", "valve anti cheat", "vac enabled"],
    "EAC":        ["easy anti-cheat", "easy anti cheat", "easyanticheat"],
    "BattlEye":   ["battleye", "battle eye"],
    "Vanguard":   ["vanguard", "riot vanguard"],
    "PunkBuster": ["punkbuster", "punk buster"],
    "nProtect":   ["nprotect", "gameguard"],
    "XIGNCODE":   ["xigncode", "xigncode3"],
    "Ricochet":   ["ricochet anti-cheat", "ricochet"],
    "mHyprot":    ["mhyprot", "mhyprot2"],
    "FACEIT AC":  ["faceit anti-cheat", "faceit ac"],
    "Denuvo AC":  ["denuvo anti-cheat"],
    "KSS":        ["kss", "krafton security"],
    "NetEase GS": ["netease game security"],
    "Hyperion":   ["hyperion", "byfron"],
}

# ──────────── Field classification ────────────
MANUAL_FIELDS = frozenset({
    "anti_cheat", "anti_cheat_note", "is_kernel_ac",
    "notes", "type_game", "safe", "genre",
})
ARRAY_FIELDS = frozenset({
    "platforms", "languages", "language_details", "tags",
    "developer", "publisher",
})
EXTENSION_FIELDS = frozenset({
    "name", "genre", "type_game", "has_paid_dlc",
    "developer", "publisher", "release_date", "description",
    "header_image", "anti_cheat", "anti_cheat_note", "is_kernel_ac",
    "platforms", "languages", "language_details", "tags",
    "notes", "safe",
})

# ──────────── Table generation ────────────
MAX_GAMES_PER_FILE = 200
TOP_ONLINE_LIMIT   = 50
