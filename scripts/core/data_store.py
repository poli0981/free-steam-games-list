"""
Data store v2.2 – JSONL I/O, validation, dedup, schema merge.

Optimizations:
  - _is_empty() simplified with early returns (no set lookup)
  - save_jsonl() uses json.dumps directly (faster than jsonlines writer for large files)
  - build_index() O(n) single pass
  - merge_extension_data() avoids repeated key lookups
"""
import glob as _glob
import json
import os
import re
from datetime import datetime, timezone
from typing import Optional

from .constants import (
    DATA_DIR, LEGACY_JSONL, TEMP_JSONL,
    MAX_RECORDS_PER_FILE, SHARD_PREFIX,
    MANUAL_FIELDS, ARRAY_FIELDS, EXTENSION_FIELDS,
)

# ──────────── Link helpers ────────────

_APPID_RE = re.compile(r"/app/(\d+)")

_EMPTY_STRINGS = frozenset({"", "N/A", "-", "?"})


def extract_appid(link: str) -> Optional[str]:
    """Extract appid from any Steam URL or bare number. O(1) regex."""
    if not link:
        return None
    m = _APPID_RE.search(link)
    return m.group(1) if m else None


def normalize_link(raw: str) -> Optional[str]:
    raw = raw.strip().rstrip("/")
    if raw.isdigit():
        return f"https://store.steampowered.com/app/{raw}/"
    appid = extract_appid(raw)
    return f"https://store.steampowered.com/app/{appid}/" if appid else None


# ──────────── Empitness check ────────────

def is_empty(val) -> bool:
    """Fast emptiness check. Hot path – called hundreds of times per game."""
    if val is None:
        return True
    if isinstance(val, str):
        return val.strip() in _EMPTY_STRINGS
    if isinstance(val, list):
        return len(val) == 0
    return False


# ──────────── JSONL I/O ────────────

def load_jsonl(path: str) -> list[dict]:
    """Load JSONL file. Returns [] if missing/empty."""
    if not os.path.isfile(path):
        return []
    records = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
    except Exception as e:
        print(f"  ⚠ Error reading {path}: {e}")
    return records


def save_jsonl(path: str, records: list[dict]):
    """Atomic write: tmp → rename. Uses json.dumps directly (faster than jsonlines)."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False))
            f.write("\n")
    os.replace(tmp, path)


# ──────────── Shard helpers ────────────

def _shard_paths() -> list[str]:
    """Return sorted list of existing shard files in DATA_DIR."""
    return sorted(_glob.glob(os.path.join(DATA_DIR, f"{SHARD_PREFIX}*.jsonl")))


def _shard_name(index: int) -> str:
    """Generate shard filename: data_001.jsonl, data_002.jsonl, ..."""
    return os.path.join(DATA_DIR, f"{SHARD_PREFIX}{index:03d}.jsonl")


# ──────────── Main data I/O (sharded) ────────────

def load_main() -> list[dict]:
    """Load all records from sharded data/ directory. Falls back to legacy file."""
    shards = _shard_paths()
    if shards:
        records = []
        for path in shards:
            records.extend(load_jsonl(path))
        return records
    if os.path.isfile(LEGACY_JSONL):
        print(f"  Loading from legacy {LEGACY_JSONL} (data/ dir empty)")
        return load_jsonl(LEGACY_JSONL)
    return []


def save_main(records: list[dict]):
    """Save records to sharded JSONL files (MAX_RECORDS_PER_FILE per shard)."""
    os.makedirs(DATA_DIR, exist_ok=True)

    chunks = []
    for i in range(0, max(len(records), 1), MAX_RECORDS_PER_FILE):
        chunks.append(records[i:i + MAX_RECORDS_PER_FILE])
    if not chunks:
        chunks = [[]]

    new_paths = set()
    for idx, chunk in enumerate(chunks, start=1):
        path = _shard_name(idx)
        new_paths.add(os.path.normpath(path))
        save_jsonl(path, chunk)

    for old in _shard_paths():
        if os.path.normpath(old) not in new_paths:
            os.remove(old)

def load_temp() -> list[dict]:
    return load_jsonl(TEMP_JSONL)

def clear_temp():
    if os.path.isfile(TEMP_JSONL):
        with open(TEMP_JSONL, "w") as f:
            f.write("")
        print(f"  ✓ Cleared {TEMP_JSONL}")


# ──────────── Timestamps ────────────

_UTC = timezone.utc

def now_iso() -> str:
    return datetime.now(_UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# ──────────── Schema ────────────

_SKELETON_TEMPLATE = {
    "link": "", "name": "", "description": "", "header_image": "",
    "genre": "", "type_game": "", "has_paid_dlc": False,
    "developer": [], "publisher": [], "release_date": "",
    "reviews": "N/A", "current_players": "N/A", "peak_today": "N/A",
    "metacritic": "N/A",
    "anti_cheat": "-", "anti_cheat_note": "", "is_kernel_ac": None,
    "platforms": [], "languages": [], "language_details": [], "tags": [],
    "drm_notes": "-",
    "notes": "", "safe": "?",
    "status": "active", "last_updated": "", "added_at": "",
}


def make_skeleton(link: str) -> dict:
    """Create a full v2.2 game record. Shallow-copies lists to avoid aliasing."""
    rec = {}
    for k, v in _SKELETON_TEMPLATE.items():
        rec[k] = list(v) if isinstance(v, list) else v
    rec["link"] = link
    rec["added_at"] = now_iso()
    return rec


def build_index(games: list[dict]) -> dict[str, int]:
    """Build appid→index map. O(n) single pass."""
    idx = {}
    for i, g in enumerate(games):
        aid = extract_appid(g.get("link", ""))
        if aid:
            idx[aid] = i
    return idx


def is_info_complete(game: dict) -> bool:
    """Check if a record has all core fetchable fields filled."""
    name = game.get("name", "")
    if not name or name == "Unknown":
        return False
    reviews = game.get("reviews", "N/A")
    if reviews in ("N/A", "Error"):
        return False
    dev = game.get("developer")
    if not dev or dev == "N/A":
        return False
    if not game.get("release_date") or game["release_date"] == "N/A":
        return False
    img = game.get("header_image", "")
    if not img or "placeholder" in img:
        return False
    return True


# ──────────── Extension data merge ────────────

def _normalize_to_list(val) -> list[str]:
    if isinstance(val, list):
        return val
    if isinstance(val, str) and val:
        return [s.strip() for s in val.split(",") if s.strip()]
    return []


# Pre-compute sets for O(1) membership tests
# Keys from extension that should NEVER be stored in data.jsonl
_SKIP_MERGE_KEYS = frozenset({
    "link", "appid", "added_at",
    # Extension-only classification (not stored server-side)
    "free_type", "is_free", "is_dlc", "is_demo", "is_playtest",
    "price", "auto_notes",
})
_NORMALIZE_LIST_KEYS = frozenset({"developer", "publisher"})
_DESC_KEYS = frozenset({"description", "desc"})


def merge_extension_data(game: dict, ext: dict) -> dict:
    """
    Merge extension data into game record.
    Optimized: single pass over ext keys, minimal dict lookups.
    """
    for key, val in ext.items():
        if key in _SKIP_MERGE_KEYS or is_empty(val):
            continue

        if key in _NORMALIZE_LIST_KEYS:
            val = _normalize_to_list(val)

        if key in _DESC_KEYS:
            target = "description"
            if is_empty(game.get(target)):
                game[target] = val
            continue

        if key in MANUAL_FIELDS:
            if is_empty(game.get(key)):
                game[key] = val
            continue

        if key in ARRAY_FIELDS:
            game[key] = val
            continue

        # EXTENSION_FIELDS or unknown: overwrite
        game[key] = val

    # Strip any ephemeral fields that may have leaked through
    for k in ("free_type", "is_free", "is_dlc", "is_demo", "is_playtest", "price", "auto_notes"):
        game.pop(k, None)
    return game


def migrate_record(game: dict) -> dict:
    """Migrate v2.0 record to v2.2. Idempotent."""
    # Add missing keys
    for key, default in _SKELETON_TEMPLATE.items():
        if key not in game:
            game[key] = list(default) if isinstance(default, list) else default

    # Normalize developer/publisher string → list
    for key in ("developer", "publisher"):
        val = game.get(key, "")
        if isinstance(val, str):
            game[key] = _normalize_to_list(val)

    # Migrate desc → description
    if "desc" in game:
        if game.get("desc") and is_empty(game.get("description")):
            game["description"] = game["desc"]
        del game["desc"]

    # Remove deprecated/ephemeral fields
    for k in ("free_type", "is_free", "is_dlc", "is_demo",
              "is_playtest", "price", "auto_notes"):
        game.pop(k, None)

    return game
