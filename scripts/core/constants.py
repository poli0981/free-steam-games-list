"""
Shared constants & configuration – v2.2
"""
import os

# ──────────── Paths ────────────
DATA_DIR       = "data"
LEGACY_JSONL   = "scripts/data.jsonl"      # fallback pre-migration
TEMP_JSONL     = "scripts/temp_info.jsonl"
REMOVED_JSONL  = "scripts/removed_games.jsonl"
GAMES_DIR      = "games"
OVERRIDES_DIR  = "data/overrides"   # one <appid>.json per human-edited game
# Games the maintainer took out of the catalogue (core/blocklist.py). Never
# name it data_*: save_main() treats data/data_*.jsonl as shards and deletes
# the ones it did not write.
BLOCKLIST_JSONL = "data/blocklist.jsonl"
# More blocked games than this in ONE save is treated as a damaged file, not a
# decision: save_main() refuses before writing anything (5 x the /admin cap).
BLOCKLIST_MAX_DROP = 500

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
# Not genres at all: a price model and a release state. Every game here is
# free, so "Free To Play" tells a reader nothing. Both are on the skip list
# above; this is what a genre may never FALL BACK to (fetcher.pick_genre), and
# what Refresh Store Data replaces when it finds one stored.
NOT_GENRES = frozenset({"Free to Play", "Early Access"})

# ──────────── Anti-Cheat patterns ────────────
# A key or a pattern matches a name only as whole words (core/anticheat.py
# _has_term; the web's canonicalAc() the same way): "ace" is inside "faceit
# ac", "space" and "interface". Mirrored, in this order, by
# web/src/lib/anti-cheat.ts and ANTI_CHEAT_ENUM (anti-cheat.test.ts).
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
    # Steam's own name for it, in a disclosure, is just "Denuvo".
    "Denuvo AC":  ["denuvo anti-cheat", "denuvo"],
    "KSS":        ["kss", "krafton security"],
    "NetEase GS": ["netease game security"],
    "Hyperion":   ["hyperion", "byfron"],
    # The names Steam's disclosures use most beyond the above (2026-10-16).
    "ACE":        ["anti-cheat expert", "anticheat expert"],
    "Anti-Cheat Toolkit": ["anti-cheat toolkit", "anticheat toolkit"],
    "CrackProof": ["crackproof"],
    "HoYoKProtect": ["hoyokprotect"],
    "NGS":        ["nexon game security"],
    "EA Javelin": ["javelin"],
    "SARD":       ["sard"],
}

# ──────────── Field classification ────────────
# Longest stored `description`, INCLUDING the ellipsis.
#
# The field holds the publisher's own store blurb, reproduced as a short
# identifying quotation so a row is recognisable — see LICENSE-DATA, which
# excludes it from the CC BY grant. Keeping it short is what makes that
# characterisation honest: at full length (median 213, longest 340) the field
# was reproducing the whole blurb rather than quoting from it.
DESCRIPTION_MAX = 180

MANUAL_FIELDS = frozenset({
    "anti_cheat", "anti_cheat_note", "is_kernel_ac",
    "notes", "type_game", "safe", "genre",
})

# Segments the PIPELINE appends to `notes`. A human override of `notes`
# re-attaches any of these it would otherwise drop: the appends are
# one-way (mark_dead_games only appends while is_dead is False), so a
# stripped marker would never come back. See core/overrides.py.
MACHINE_NOTE_MARKERS = (
    "💀 Dead game",
    "💀 Delisted",
    "⚠ No longer free!",
)

TOP_ONLINE_LIMIT   = 100
TOP_OFFLINE_LIMIT  = 100
