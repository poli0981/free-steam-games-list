#!/usr/bin/env python3
"""Normalize the `genre` field across data/data_*.jsonl to canonical names.

Fixes inconsistent casing / spelling for compound genres, e.g.:
  "Hack and Slash"      → "Hack & Slash"
  "Turn-Based Strategy" → "Turn-based Strategy"
  "Top-Down Shooter"    → "Top-down Shooter"
  "Third-Person Shooter"→ "Third-person Shooter"
  "Rougelite"           → "Roguelite"   (typo)
  …

Comma-separated values like "Action RPG, Gacha" are flagged for manual
review rather than auto-split — the canonical schema is single-genre.

Usage:
  python scripts/normalize_genres.py            # dry-run, prints report
  python scripts/normalize_genres.py --apply    # write to data/data_*.jsonl
  python scripts/normalize_genres.py -v         # add per-game detail
"""
import sys, os, argparse, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collections import Counter
from core.data_store import load_main, save_main, extract_appid

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


# Canonical → known aliases. Sentence-case style for compounds.
# Matching is case/whitespace/dash/apostrophe-insensitive (see _norm_key).
CANONICAL_ALIASES: dict[str, list[str]] = {
    "Hack & Slash": [
        "hack and slash", "hack-and-slash",
        "hack n slash", "hack n' slash",
    ],
    "Roguelite": [
        "rougelite",
    ],
    "Turn-based Strategy": [
        "turn-Based Strategy", "turn based strategy",
    ],
    "Turn-based Tactics": [
        "turn-Based Tactics", "turn based tactics",
    ],
    "Turn-based RPG": [
        "turn-Based RPG", "turn based rpg",
    ],
    "Turn-based Combat": [
        "turn-Based Combat", "turn based combat",
    ],
    "Top-down Shooter": [
        "top-Down Shooter", "top down shooter",
    ],
    "Third-person Shooter": [
        "third-Person Shooter", "third person shooter",
    ],
    "Shoot 'em up": [
        "shoot 'Em up", "shoot em up", "shoot'em up", "shoot-em-up",
    ],
    "Point & Click": [
        "point and click", "point-and-click",
    ],
}


def _norm_key(s: str) -> str:
    """Lowercase, collapse spaces, fold curly quotes/dashes to ASCII."""
    s = s.strip().lower()
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("–", "-").replace("—", "-")
    s = re.sub(r"\s+", " ", s)
    return s


_ALIAS_MAP: dict[str, str] = {}
for _canonical, _aliases in CANONICAL_ALIASES.items():
    _ALIAS_MAP[_norm_key(_canonical)] = _canonical
    for _alias in _aliases:
        _ALIAS_MAP[_norm_key(_alias)] = _canonical


def normalize_genre(g: str) -> str | None:
    """Return canonical genre if a change is needed, else None."""
    if not g:
        return None
    canonical = _ALIAS_MAP.get(_norm_key(g))
    if canonical and canonical != g:
        return canonical
    return None


def main():
    ap = argparse.ArgumentParser(description="Normalize genre field in JSONL.")
    ap.add_argument("--apply", action="store_true",
                    help="Write changes to data/data_*.jsonl (default: dry-run).")
    ap.add_argument("--verbose", "-v", action="store_true",
                    help="Print per-game changes (default: summary only).")
    args = ap.parse_args()

    games = load_main()
    print("==== Genre Normalization Report ====")
    print(f"Loaded {len(games)} games from sharded JSONL.\n")

    changes: list[tuple[str, str, str, str]] = []  # (old, new, appid, name)
    multi_genre: list[tuple[str, str, str]] = []   # (raw, appid, name)
    pair_counts: Counter[tuple[str, str]] = Counter()

    for g in games:
        genre = g.get("genre", "")
        if not genre or genre in ("N/A", "-"):
            continue
        if "," in genre:
            multi_genre.append((
                genre,
                extract_appid(g.get("link", "")) or "?",
                g.get("name", "Unknown"),
            ))
            continue
        new = normalize_genre(genre)
        if new is None:
            continue
        changes.append((
            genre, new,
            extract_appid(g.get("link", "")) or "?",
            g.get("name", "Unknown"),
        ))
        pair_counts[(genre, new)] += 1

    label = "Changes applied" if args.apply else "Changes proposed (dry-run)"
    print(f"{label}:")
    if not pair_counts:
        print("  (none — data already canonical)")
    else:
        for (old, new), n in sorted(pair_counts.items(), key=lambda x: (-x[1], x[0])):
            suffix = "s" if n != 1 else ""
            print(f'  "{old}"  →  "{new}"  ({n} game{suffix})')
        print(f"\n  Total: {len(changes)} games updated, "
              f"{len(pair_counts)} unique canonical changes.")
    print()

    if args.verbose and changes:
        print("Per-game detail:")
        for old, new, appid, name in changes:
            print(f'  [{appid}] {name}: "{old}" → "{new}"')
        print()

    if multi_genre:
        print(f"Manual review needed ({len(multi_genre)} comma-separated):")
        for raw, appid, name in multi_genre:
            print(f'  "{raw}"  — appid {appid} ({name})')
        print()

    if args.apply:
        if changes:
            for g in games:
                genre = g.get("genre", "")
                if not genre or "," in genre:
                    continue
                new = normalize_genre(genre)
                if new is not None:
                    g["genre"] = new
            save_main(games)
            print(f"OK Wrote {len(games)} records to data/data_*.jsonl")
        else:
            print("Nothing to write.")
    else:
        print("[DRY-RUN] No files written. Use --apply to commit changes.")


if __name__ == "__main__":
    main()
