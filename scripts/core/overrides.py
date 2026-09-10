"""
Human edits as standing instructions, not one-time mutations.

The problem this solves
-----------------------
MANUAL_FIELDS (anti_cheat, anti_cheat_note, is_kernel_ac, notes, type_game,
safe, genre) are protected only by "fill if empty": merge_extension_data()
skips them when the existing value is non-empty. Nothing anywhere records which
value a human chose and which a scraper guessed, so:

  * `normalize_genres.py --apply` rewrites `genre` for every game and cannot
    tell a correction from scraper output;
  * `refetch_all.py` re-fetches everything;

and a hand-made correction is reverted with no error and no trace.

An override is therefore NOT applied once. It lives permanently in Git as
`data/overrides/<appid>.json`, and `apply_overrides()` is called from inside
`save_main()` — the single choke point through which all 11 data-writing
scripts pass, and the only code that writes `data/data_*.jsonl`. Whatever a
script did to a record, the human's decision is re-imposed as the last act
before bytes hit the disk. No script needs to know this layer exists.

Retiring an override
--------------------
Deleting the file is not enough to undo an edit: `apply_details()` is also
fill-if-empty, so the pre-edit scraped value never comes back on its own and
the field stays pinned to the human value forever. So an entry is *retired*
rather than deleted — it moves to `retired` carrying `was`, the value from
before the edit. apply_overrides() writes `was` back only while the stored
value still equals the retired override's value; after that the two differ and
it is a permanent no-op. Self-cleaning, and idempotent by construction.
"""
import json
import os
from typing import Optional

from .constants import MANUAL_FIELDS, MACHINE_NOTE_MARKERS, OVERRIDES_DIR

OVERRIDE_SCHEMA = 1


def override_path(appid: str) -> str:
    return os.path.join(OVERRIDES_DIR, f"{appid}.json")


def load_overrides() -> dict[str, dict]:
    """{appid: override document}. A malformed file is skipped, not fatal.

    One bad file must not stop every other override from applying — that would
    turn a typo into a silent mass revert, which is the failure this module
    exists to prevent.
    """
    out: dict[str, dict] = {}
    if not os.path.isdir(OVERRIDES_DIR):
        return out
    for name in sorted(os.listdir(OVERRIDES_DIR)):
        if not name.endswith(".json"):
            continue
        appid = name[:-5]
        if not appid.isdigit():
            continue
        try:
            with open(os.path.join(OVERRIDES_DIR, name), encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, ValueError) as exc:
            print(f"  overrides: SKIPPED {name}: {exc}")
            continue
        if isinstance(doc, dict):
            out[appid] = doc
    return out


def save_override(doc: dict) -> str:
    """Write one override document. Returns the path."""
    os.makedirs(OVERRIDES_DIR, exist_ok=True)
    path = override_path(doc["appid"])
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2, sort_keys=False)
        fh.write("\n")
    return path


def _marker_segment(text: str, marker: str) -> str:
    """The machine-appended note starting at `marker`, up to the next marker."""
    start = text.index(marker)
    later = [text.index(m) for m in MACHINE_NOTE_MARKERS
             if m in text and text.index(m) > start]
    return text[start:min(later)].strip() if later else text[start:].strip()


def preserve_machine_notes(current: str, human: str) -> str:
    """Re-attach machine-appended markers that the human value would drop.

    `notes` is a hybrid field: the pipeline appends its own segments to it —
    check_dead_links adds "Delisted", mark_dead_games adds "Dead game",
    fetcher adds "No longer free!". Those appends are one-way. mark_dead_games
    only calls append_note_idempotent() when `is_dead` is still False, so once
    a game is marked, a stripped marker is NEVER re-appended. A plain
    whole-value override of `notes` would therefore erase the dead-game marker
    permanently, with nothing to restore it.
    """
    current = current or ""
    out = (human or "").strip()
    for marker in MACHINE_NOTE_MARKERS:
        if marker in current and marker not in out:
            seg = _marker_segment(current, marker)
            out = f"{out} {seg}".strip() if out else seg
    return out


class ApplyStats:
    """What one apply_overrides() pass did. Printed by save_main()."""

    __slots__ = ("enforced", "changed", "restored", "records", "orphans", "rejected")

    def __init__(self) -> None:
        self.enforced = 0   # fields an override currently governs
        self.changed = 0    # fields this pass actually rewrote
        self.restored = 0   # retired overrides that put `was` back
        self.records = 0    # records touched
        self.orphans: list[str] = []            # override with no matching record
        self.rejected: list[tuple[str, str, str]] = []  # (appid, field, reason)

    def summary(self) -> str:
        bits = [f"{self.enforced} field(s) enforced"]
        if self.changed:
            bits.append(f"{self.changed} rewritten across {self.records} record(s)")
        if self.restored:
            bits.append(f"{self.restored} restored")
        if self.orphans:
            bits.append(f"{len(self.orphans)} orphan(s): {', '.join(self.orphans[:5])}")
        if self.rejected:
            shown = "; ".join(f"{a}.{f}: {r}" for a, f, r in self.rejected[:5])
            bits.append(f"{len(self.rejected)} REJECTED ({shown})")
        return "  overrides: " + ", ".join(bits)


def validate_value(field: str, value) -> Optional[str]:
    """None when acceptable, else the reason it is not.

    Empty values are refused on purpose. A field set to "" would be refilled by
    the next scrape (fill-if-empty) and blanked again by this layer on the way
    out — a flip-flop that rewrites shards on every single run. Clearing a
    field is what RETIRING is for.
    """
    if field not in MANUAL_FIELDS:
        return f"not a manual field (allowed: {', '.join(sorted(MANUAL_FIELDS))})"

    if field == "is_kernel_ac":
        if value is None or isinstance(value, bool):
            return None
        return "must be true, false or null"

    if not isinstance(value, str):
        return f"must be a string, got {type(value).__name__}"
    if not value.strip():
        return "empty - retire the override instead of blanking the field"

    if field == "type_game" and value not in ("online", "offline"):
        return "must be 'online' or 'offline'"
    if field == "safe" and value not in ("y", "n", "?"):
        return "must be 'y', 'n' or '?'"
    if len(value) > 500:
        return "longer than 500 characters"
    return None


def apply_overrides(games: list[dict], quiet: bool = False) -> ApplyStats:
    """Re-impose every human decision onto `games`, in place.

    Called from save_main(), so this runs as the last mutation of every write
    to data/. Deliberately tolerant: an override naming an unknown field, an
    unacceptable value, or a game no longer in the catalogue is counted and
    reported, never raised — a bad override must not be able to abort a
    pipeline run that has already spent two hours scraping.
    """
    # Imported here rather than at module scope: data_store imports this module
    # from inside save_main(), so a top-level import would be circular.
    from .data_store import extract_appid, now_iso

    stats = ApplyStats()
    overrides = load_overrides()
    if not overrides:
        return stats

    by_appid: dict[str, dict] = {}
    for game in games:
        appid = extract_appid(game.get("link", ""))
        if appid:
            by_appid[appid] = game

    for appid, doc in overrides.items():
        game = by_appid.get(appid)
        if game is None:
            # The game was delisted or purged. Keep the file: if it is ever
            # re-added the decision applies again, which is the point.
            stats.orphans.append(appid)
            continue

        touched = False

        for field, entry in (doc.get("fields") or {}).items():
            if not isinstance(entry, dict):
                stats.rejected.append((appid, field, "entry is not an object"))
                continue
            value = entry.get("value")
            reason = validate_value(field, value)
            if reason:
                stats.rejected.append((appid, field, reason))
                continue

            if field == "notes":
                value = preserve_machine_notes(game.get("notes", ""), value)

            stats.enforced += 1
            if game.get(field) != value:
                game[field] = value
                stats.changed += 1
                touched = True

        for field, entry in (doc.get("retired") or {}).items():
            if not isinstance(entry, dict) or field not in MANUAL_FIELDS:
                continue
            # Restore only while the stored value is still the one this
            # override put there. Once restored the two differ, so every later
            # pass is a no-op and the entry can stay in the file as history.
            if game.get(field) == entry.get("value"):
                game[field] = entry.get("was")
                stats.restored += 1
                touched = True

        if touched:
            # Only when something actually moved. Bumping last_updated
            # unconditionally would rewrite every overridden record on every
            # run and turn each commit into a full-shard diff.
            game["last_updated"] = now_iso()
            stats.records += 1

    if not quiet and (stats.enforced or stats.orphans or stats.rejected):
        print(stats.summary())
    return stats
