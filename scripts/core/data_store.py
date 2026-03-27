"""
Data store v2.1 – JSONL I/O, validation, deduplication, schema merge.

New in v2.1:
  - Expanded skeleton with publisher, platforms, languages, tags, etc.
  - merge_extension_data() for merging rich extension output into records
  - Smart merge: arrays are replaced wholesale, scalars respect MANUAL_FIELDS
"""
import os
import re
from datetime import datetime, timezone
from typing import Optional

import jsonlines

from .constants import (
    DATA_JSONL, TEMP_JSONL,
    MANUAL_FIELDS, ARRAY_FIELDS, EXTENSION_FIELDS,
)

# ──────────── Link helpers ────────────

_APPID_RE = re.compile(r"store\.steampowered\.com/app/(\d+)")


def extract_appid(link: str) -> Optional[str]:
    m = _APPID_RE.search(link)
    return m.group(1) if m else None


def normalize_link(raw: str) -> Optional[str]:
    raw = raw.strip().rstrip("/")
    if raw.isdigit():
        return f"https://store.steampowered.com/app/{raw}/"
    appid = extract_appid(raw)
    if appid:
        return f"https://store.steampowered.com/app/{appid}/"
    return None


# ──────────── JSONL I/O ────────────

def load_jsonl(path: str) -> list[dict]:
    if not os.path.isfile(path):
        return []
    try:
        with jsonlines.open(path, "r") as reader:
            return list(reader)
    except Exception as e:
        print(f"  ⚠ Error reading {path}: {e}")
        return []


def save_jsonl(path: str, records: list[dict]):
    tmp = path + ".tmp"
    with jsonlines.open(tmp, "w") as writer:
        for rec in records:
            writer.write(rec)
    os.replace(tmp, path)


def load_main() -> list[dict]:
    return load_jsonl(DATA_JSONL)

def save_main(records: list[dict]):
    save_jsonl(DATA_JSONL, records)

def load_temp() -> list[dict]:
    return load_jsonl(TEMP_JSONL)

def clear_temp():
    if os.path.isfile(TEMP_JSONL):
        with open(TEMP_JSONL, "w") as f:
            f.write("")
        print(f"  ✓ Cleared {TEMP_JSONL}")


# ──────────── Timestamps ────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ──────────── Schema ────────────

def make_skeleton(link: str) -> dict:
    """Create a full game record with all v2.1 fields."""
    return {
        # Identity
        "link": link,
        "name": "",
        "description": "",
        "header_image": "",

        # Classification
        "genre": "",
        "type_game": "offline",
        "has_paid_dlc": False,

        # People
        "developer": [],
        "publisher": [],
        "release_date": "",

        # Stats (fetched from API)
        "reviews": "N/A",
        "current_players": "N/A",
        "peak_today": "N/A",
        "metacritic": "N/A",

        # Anti-cheat
        "anti_cheat": "-",
        "anti_cheat_note": "",
        "is_kernel_ac": None,

        # Supplementary
        "platforms": [],
        "languages": [],
        "language_details": [],
        "tags": [],
        "drm_notes": "-",

        # User annotations
        "notes": "",
        "safe": "?",

        # Status
        "status": "active",
        "last_updated": "",
        "added_at": now_iso(),
    }


def build_index(games: list[dict]) -> dict[str, int]:
    idx = {}
    for i, g in enumerate(games):
        aid = extract_appid(g.get("link", ""))
        if aid:
            idx[aid] = i
    return idx


def is_info_complete(game: dict) -> bool:
    checks = {
        "name": lambda v: v and v not in ("", "Unknown"),
        "reviews": lambda v: v and v not in ("N/A", "Error"),
        "developer": lambda v: v and v != [] and v != "N/A",
        "release_date": lambda v: v and v != "N/A",
        "header_image": lambda v: v and "placeholder" not in v,
    }
    return all(fn(game.get(k, "")) for k, fn in checks.items())


# ──────────── Extension data merge ────────────

def _is_empty(val) -> bool:
    """Check if a value is considered 'empty' (should not overwrite)."""
    if val is None:
        return True
    if isinstance(val, str) and val.strip() in ("", "N/A", "-", "?"):
        return True
    if isinstance(val, list) and len(val) == 0:
        return True
    return False


def _normalize_developer(val) -> list[str]:
    """Ensure developer is always a list."""
    if isinstance(val, list):
        return val
    if isinstance(val, str) and val:
        return [d.strip() for d in val.split(",") if d.strip()]
    return []


def merge_extension_data(game: dict, ext: dict) -> dict:
    """
    Merge extension-provided data into a game record.

    Rules:
      1. MANUAL_FIELDS: only set if game's current value is empty
         (preserves user overrides)
      2. ARRAY_FIELDS: replace wholesale if extension provides non-empty array
         (extension data is richer than API)
      3. Other EXTENSION_FIELDS: overwrite if extension provides non-empty value
      4. developer/publisher: normalize to list format
      5. 'description' maps to both 'description' and 'desc' (backward compat)

    Extension fields NOT in EXTENSION_FIELDS are preserved as-is
    (future-proofing).
    """
    for key, val in ext.items():
        if key in ("link", "appid", "added_at", "free_type"):
            continue  # Identity / deprecated fields

        if _is_empty(val):
            continue

        # Normalize developer/publisher to list
        if key in ("developer", "publisher"):
            val = _normalize_developer(val)

        # Handle 'description' (and legacy 'desc' input → normalize to 'description')
        if key == "description":
            game["description"] = val
            continue
        if key == "desc":
            if _is_empty(game.get("description")):
                game["description"] = val
            continue

        # MANUAL_FIELDS: only fill if empty (don't overwrite user edits)
        if key in MANUAL_FIELDS:
            if _is_empty(game.get(key)):
                game[key] = val
            continue

        # ARRAY_FIELDS: replace with richer data
        if key in ARRAY_FIELDS:
            game[key] = val
            continue

        # Everything else in EXTENSION_FIELDS: overwrite
        if key in EXTENSION_FIELDS:
            game[key] = val
            continue

        # Unknown fields from extension: preserve for future use
        game[key] = val

    return game


def migrate_record(game: dict) -> dict:
    """
    Migrate a v2.0 record to v2.1 schema.
    Adds missing fields with defaults, normalizes types.
    """
    skeleton = make_skeleton(game.get("link", ""))

    # Add missing keys from skeleton
    for key, default in skeleton.items():
        if key not in game:
            game[key] = default

    # Normalize developer: string → list
    dev = game.get("developer", "")
    if isinstance(dev, str):
        game["developer"] = _normalize_developer(dev)

    # Normalize publisher
    pub = game.get("publisher", "")
    if isinstance(pub, str):
        game["publisher"] = _normalize_developer(pub)

    # Migrate legacy 'desc' → 'description', then drop 'desc'
    if "desc" in game:
        if game.get("desc") and _is_empty(game.get("description")):
            game["description"] = game["desc"]
        del game["desc"]

    # Remove deprecated 'free_type' field
    game.pop("free_type", None)

    return game
