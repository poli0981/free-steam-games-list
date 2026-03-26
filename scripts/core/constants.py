"""
Shared constants & configuration for the Steam F2P tracker v2.1.

Changelog v2.1:
  - Expanded game schema: publisher, platforms, languages, language_details,
    tags, description, free_type, has_paid_dlc, anti_cheat_note, is_kernel_ac
  - Anti-cheat registry (mirrors extension detector.js ANTI_CHEAT_DB)
  - New merge rules for array vs scalar fields
"""
import os

# ──────────── Paths ────────────
DATA_JSONL       = "scripts/data.jsonl"
TEMP_JSONL       = "scripts/temp_info.jsonl"
DEAD_LINKS_LOG   = "scripts/dead_links.log"
REMOVED_JSONL    = "scripts/removed_games.jsonl"
GAMES_DIR        = "games"

# ──────────── Steam API ────────────
STEAM_API_KEY    = os.getenv("STEAM_API_KEY", "")
IS_CI            = os.getenv("GITHUB_ACTIONS") == "true"

# ──────────── Rate limiting ────────────
STORE_DELAY_MIN  = 1.2 if IS_CI else 1.5
STORE_DELAY_MAX  = 2.0 if IS_CI else 3.0
API_DELAY_MIN    = 0.3 if IS_CI else 0.5
API_DELAY_MAX    = 0.8 if IS_CI else 1.2

BATCH_SIZE       = 50
BATCH_PAUSE_MIN  = 15
BATCH_PAUSE_MAX  = 30

MAX_RETRIES      = 3
RETRY_BACKOFF    = 2.0
RETRY_429_WAIT   = 60

# ──────────── Genre tag filter ────────────
SKIP_GENRE_TAGS = frozenset({
    "Free to Play", "Indie", "Casual", "Early Access", "Multiplayer",
    "Singleplayer", "Co-op", "Online Co-Op", "PvP",
    "Cross-Platform Multiplayer", "In-App Purchases",
    "Massively Multiplayer", "Competitive",
})

# ──────────── Anti-Cheat Registry ────────────
# Mirrors extension ANTI_CHEAT_DB for consistency.
# Used by fetcher to detect AC from Steam API categories.
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

# ──────────── Fields that extension can provide ────────────
# These are NEVER overwritten by Steam API fetch if already set.
MANUAL_FIELDS = frozenset({
    "anti_cheat", "anti_cheat_note", "is_kernel_ac",
    "notes", "type_game", "safe", "genre", "free_type",
})

# Fields from extension that are arrays and should be preserved as-is
ARRAY_FIELDS = frozenset({
    "platforms", "languages", "language_details", "tags",
    "developer", "publisher",
})

# All extension-provided fields (superset of MANUAL + ARRAY + auto)
EXTENSION_FIELDS = frozenset({
    "name", "genre", "type_game", "free_type", "has_paid_dlc",
    "developer", "publisher", "release_date", "description",
    "header_image", "anti_cheat", "anti_cheat_note", "is_kernel_ac",
    "platforms", "languages", "language_details", "tags",
    "notes", "safe",
})

# ──────────── Table generation ────────────
MAX_GAMES_PER_FILE = 200
TOP_ONLINE_LIMIT   = 50
