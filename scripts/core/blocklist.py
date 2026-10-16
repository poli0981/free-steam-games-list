"""
Games the maintainer took out of the catalogue, as a standing instruction.

data/blocklist.jsonl holds one line per blocked game. It is written by the
Worker (/admin/remove appends lines, Restore deletes one) and by
scripts/delete_game.py, and only READ here. Like data/overrides/, it is human
intent that every write re-imposes: save_main() drops a blocked record before
anything else happens to it, so no writer - the ingest of a link queued again,
a full refetch, a purge - can put the game back. The
only way back is to delete the line (Restore in /admin), which also queues the
link for ingest_new.py in the same commit.

A drop is logged once in scripts/removed_games.jsonl, built from the blocklist
line alone. Its removed_at IS the line's blocked_at, so writing it again is a
byte-for-byte no-op and the log cannot churn (data_store.log_admin_removals).

Line format, keys in this order, compact separators (the Worker writes the
same bytes - web/shared/removal.ts, held equal by the golden fixture in
scripts/tests/fixtures/blocklist_golden.jsonl):

  {"appid":"730","link":"https://store.steampowered.com/app/730/",
   "name":"Counter-Strike 2","reason":"not_a_game","note":"","blocked_at":
   "2026-10-13T12:00:00Z","by":"admin"}

Standard library only: scripts/core/* is stdlib-only, and the discovery
workflows import this without installing anything.
"""
import json
import os
import re
from typing import Iterable, Optional

from .constants import BLOCKLIST_JSONL

# The reason codes /admin offers, with the words the public log shows.
# web/shared/removal.ts REMOVAL_REASONS mirrors this table (a vitest reads it
# from this file and compares).
REASONS: dict[str, str] = {
    "not_free": "No longer free to play",
    "not_a_game": "Not a game (DLC, demo, tool or soundtrack)",
    "duplicate": "Duplicate entry",
    "broken": "Unplayable or shut down",
    "inappropriate": "Does not fit the catalogue",
    "other": "Other",
}

ENTRY_KEYS = ("appid", "link", "name", "reason", "note", "blocked_at", "by")

# Written into every line instead of a person: the file is public forever.
ATTRIBUTION = "admin"

STATUS_CODE = "admin_removed"

_APPID = re.compile(r"^\d{1,10}$")
# now_iso()'s shape exactly. dedup_removed() compares removed_at as a string,
# so a millisecond suffix would sort differently from the pipeline's own rows.
_ISO_SECONDS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class BlocklistError(RuntimeError):
    """A blocklist that would remove an implausible number of games at once."""


def canonical_link(appid: str) -> str:
    return f"https://store.steampowered.com/app/{appid}/"


def entry_problem(entry: object) -> Optional[str]:
    """Why a parsed line cannot be honoured, or None when it can."""
    if not isinstance(entry, dict):
        return "not an object"
    appid = entry.get("appid")
    if not isinstance(appid, str) or not _APPID.match(appid):
        return "appid must be 1-10 digits, as a string"
    blocked_at = entry.get("blocked_at")
    if not isinstance(blocked_at, str) or not _ISO_SECONDS.match(blocked_at):
        # Without a fixed timestamp the log line would be stamped anew on every
        # write and rewritten forever.
        return "blocked_at must look like 2026-10-13T12:00:00Z"
    if entry.get("reason") not in REASONS:
        return f"reason must be one of {', '.join(REASONS)}"
    for key in ("link", "name", "note"):
        if not isinstance(entry.get(key, ""), str):
            return f"{key} must be a string"
    return None


def read_lines(path: str = BLOCKLIST_JSONL) -> list[str]:
    """The file's non-empty lines, verbatim. [] when it does not exist."""
    if not os.path.isfile(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return [line.rstrip("\n") for line in f if line.strip()]


def load_blocklist(path: str = BLOCKLIST_JSONL, quiet: bool = False) -> dict[str, dict]:
    """appid -> entry for every line that can be honoured.

    Tolerant on purpose, like apply_overrides(): a bad line is reported and
    skipped, never raised. A skipped line blocks nothing, so the worst a
    damaged line can do is fail to remove one game - `delete_game.py --check`
    (run in CI) is what makes it visible. The LAST valid line for an appid wins.
    """
    out: dict[str, dict] = {}
    for lineno, line in enumerate(read_lines(path), 1):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as e:
            if not quiet:
                print(f"  [blocklist] {path}:{lineno} bad JSON, ignored: {e}")
            continue
        problem = entry_problem(entry)
        if problem:
            if not quiet:
                print(f"  [blocklist] {path}:{lineno} ignored: {problem}")
            continue
        out[entry["appid"]] = entry
    return out


def blocked_appids(path: str = BLOCKLIST_JSONL) -> set[str]:
    return set(load_blocklist(path, quiet=True))


def make_entry(appid: str, name: str, reason: str, note: str, blocked_at: str,
               link: Optional[str] = None) -> dict:
    entry = {
        "appid": appid,
        "link": link or canonical_link(appid),
        "name": clean_text(name, 300),
        "reason": reason,
        "note": clean_text(note, 300),
        "blocked_at": blocked_at,
        "by": ATTRIBUTION,
    }
    problem = entry_problem(entry)
    if problem:
        raise ValueError(problem)
    return entry


def clean_text(value: str, limit: int) -> str:
    """A one-line note: control characters and line breaks (U+2028/U+2029
    included) become spaces, runs of whitespace collapse, at most `limit`
    characters. web/shared/removal.ts cleanText() is the same rule."""
    out = []
    for ch in value or "":
        out.append(" " if (ord(ch) < 0x20 or 0x7F <= ord(ch) < 0xA0 or ch in "\u2028\u2029") else ch)
    return " ".join("".join(out).split())[:limit]


def serialize_entry(entry: dict) -> str:
    """One line, without its newline: keys in ENTRY_KEYS order, compact
    separators, non-ASCII kept as is - except U+2028/U+2029, escaped, because
    str.splitlines() and some editors treat them as line breaks and would cut a
    line in two. web/shared/removal.ts serializeEntry() writes the same bytes."""
    ordered = {key: entry.get(key, "") for key in ENTRY_KEYS}
    text = json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))
    return text.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def public_reason(entry: dict) -> str:
    """The reason the public removed-games log shows. The free-text note is
    deliberately left out of it (it stays in the blocklist and the commit)."""
    return f"Removed by the maintainer: {REASONS.get(entry.get('reason', ''), 'Other')}"


def removed_row(entry: dict) -> dict:
    """The scripts/removed_games.jsonl line for a blocked game. Built from the
    blocklist line alone, so it is identical however often it is written."""
    return {
        "link": entry.get("link") or canonical_link(entry["appid"]),
        "name": entry.get("name", ""),
        "appid": entry["appid"],
        "reason": public_reason(entry),
        "status_code": STATUS_CODE,
        "removed_at": entry["blocked_at"],
    }


def split_blocked(records: Iterable[dict], blocked: dict[str, dict],
                  appid_of) -> tuple[list[dict], list[dict]]:
    """(kept, dropped). A record whose appid cannot be read is kept: this
    module only ever removes what it can name."""
    kept: list[dict] = []
    dropped: list[dict] = []
    for record in records:
        appid = appid_of(record.get("link", "")) if isinstance(record, dict) else None
        (dropped if appid and appid in blocked else kept).append(record)
    return kept, dropped
