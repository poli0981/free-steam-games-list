"""
Data store – JSONL I/O, validation, deduplication.
"""
import json
import os
import re
from datetime import datetime, timezone
from typing import Optional

import jsonlines

from .constants import DATA_JSONL, TEMP_JSONL

# ──────────── Link helpers ────────────

_APPID_RE = re.compile(r"store\.steampowered\.com/app/(\d+)")

def extract_appid(link: str) -> Optional[str]:
    """Extract numeric appid from a Steam store URL. Returns None if invalid."""
    m = _APPID_RE.search(link)
    return m.group(1) if m else None


def normalize_link(raw: str) -> Optional[str]:
    """
    Normalize a Steam link to canonical form.
    Accepts: full URL, short URL, or bare appid.
    Returns canonical URL or None if unparseable.
    """
    raw = raw.strip().rstrip("/")
    # Bare number
    if raw.isdigit():
        return f"https://store.steampowered.com/app/{raw}/"
    appid = extract_appid(raw)
    if appid:
        return f"https://store.steampowered.com/app/{appid}/"
    return None


# ──────────── JSONL I/O ────────────

def load_jsonl(path: str) -> list[dict]:
    """Load a JSONL file. Returns empty list if file missing or empty."""
    if not os.path.isfile(path):
        return []
    try:
        with jsonlines.open(path, "r") as reader:
            return list(reader)
    except Exception as e:
        print(f"  ⚠ Error reading {path}: {e}")
        return []


def save_jsonl(path: str, records: list[dict]):
    """Atomically write records to JSONL (write-tmp then rename)."""
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
    """Truncate temp file after successful ingest."""
    if os.path.isfile(TEMP_JSONL):
        with open(TEMP_JSONL, "w") as f:
            f.write("")
        print(f"  ✓ Cleared {TEMP_JSONL}")


# ──────────── Record helpers ────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_skeleton(link: str) -> dict:
    """Create a minimal game record from a normalized link."""
    return {
        "link": link,
        "name": "",
        "desc": "",
        "header_image": "",
        "genre": "",
        "developer": "",
        "release_date": "",
        "reviews": "N/A",
        "current_players": "N/A",
        "peak_today": "N/A",
        "anti_cheat": "-",
        "metacritic": "N/A",
        "drm_notes": "-",
        "type_game": "offline",
        "notes": "",
        "safe": "?",
        "status": "active",
        "last_updated": "",
        "added_at": now_iso(),
    }


def build_index(games: list[dict]) -> dict[str, int]:
    """Build appid → list-index mapping for O(1) duplicate checks."""
    idx = {}
    for i, g in enumerate(games):
        aid = extract_appid(g.get("link", ""))
        if aid:
            idx[aid] = i
    return idx


def is_info_complete(game: dict) -> bool:
    """Check if a record has all fetchable fields populated."""
    checks = {
        "name": lambda v: v and v not in ("", "Unknown"),
        "reviews": lambda v: v and v not in ("N/A", "Error"),
        "developer": lambda v: v and v != "N/A",
        "release_date": lambda v: v and v != "N/A",
        "header_image": lambda v: v and "placeholder" not in v,
    }
    return all(fn(game.get(k, "")) for k, fn in checks.items())
