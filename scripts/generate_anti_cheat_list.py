#!/usr/bin/env python3
"""Generate games/anti-cheat-list.md grouped by anti-cheat family.

Reads the active catalogue, buckets games by canonical AC label
(`ANTI_CHEAT_PATTERNS` keys), and emits one section per family with a
6-column table sorted by current_players desc. Games with an
unrecognised `anti_cheat` string land in an "Other" bucket and print
a stderr warning for manual review.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Force UTF-8 stdout — Windows cp1252 console can't render Steam game
# names with CJK / non-ASCII characters. CI on ubuntu already runs UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

from datetime import datetime, timezone

from core.constants import GAMES_DIR, ANTI_CHEAT_PATTERNS
from core.data_store import load_main


def _ppc(s: str) -> int:
    """Parse current_players string to int. Returns 0 on N/A or junk."""
    if not s:
        return 0
    c = s.replace(",", "").strip()
    return int(c) if c.isdigit() else 0


def _canonical_ac(raw: str) -> str | None:
    """Map a free-text anti_cheat field to a canonical key from
    ANTI_CHEAT_PATTERNS, or None if no pattern matches.

    Returns None for "no AC" sentinel values; caller filters those out.
    """
    if not raw:
        return None
    s = raw.strip().lower()
    if s in ("", "-", "none", "no", "n/a"):
        return None
    for canonical, patterns in ANTI_CHEAT_PATTERNS.items():
        if canonical.lower() in s:
            return canonical
        for p in patterns:
            if p in s:
                return canonical
    return "Other"


def _truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def main():
    games = load_main()
    active = [g for g in games if g.get("status", "active") == "active"]

    buckets: dict[str, list[dict]] = {}
    unrecognised: list[tuple[str, str]] = []
    for g in active:
        ac_raw = (g.get("anti_cheat") or "").strip()
        canonical = _canonical_ac(ac_raw)
        if canonical is None:
            continue
        if canonical == "Other":
            unrecognised.append((g.get("name", "?"), ac_raw))
        buckets.setdefault(canonical, []).append(g)

    # Sort: pattern order first (keeps the well-known AC families up top),
    # then "Other" at the end. Within each bucket, current_players desc.
    canonical_order = [k for k in ANTI_CHEAT_PATTERNS.keys() if k in buckets]
    if "Other" in buckets:
        canonical_order.append("Other")

    for key in buckets:
        buckets[key].sort(key=lambda g: _ppc(g.get("current_players", "0")), reverse=True)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    total_games = sum(len(v) for v in buckets.values())

    os.makedirs(GAMES_DIR, exist_ok=True)
    path = os.path.join(GAMES_DIR, "anti-cheat-list.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("# Anti-Cheat Index\n\n")
        f.write(
            f"> {now} | {total_games} active games across "
            f"{len(canonical_order)} anti-cheat families\n\n"
        )
        f.write(
            "Games grouped by detected anti-cheat. The `anti_cheat` field is "
            "user-edited free text; this list canonicalises values via "
            "`scripts/core/constants.py::ANTI_CHEAT_PATTERNS`. Kernel column "
            "reflects `is_kernel_ac` boolean.\n\n"
        )

        # Table of contents
        f.write("## Families\n\n")
        for key in canonical_order:
            count = len(buckets[key])
            anchor = key.lower().replace(" ", "-")
            f.write(f"- [{key}](#{anchor}) — {count}\n")
        f.write("\n")

        # Per-family sections
        for key in canonical_order:
            rows = buckets[key]
            f.write(f"## {key}\n\n")
            f.write(f"*{len(rows)} games*\n\n")
            f.write("| # | Game | Genre | Kernel | Players | Link |\n")
            f.write("|---|------|-------|--------|---------|------|\n")
            for rank, g in enumerate(rows, 1):
                name = _truncate(g.get("name", "?"), 50)
                genre = g.get("genre", "—") or "—"
                kernel = "🔴 yes" if g.get("is_kernel_ac") is True else (
                    "🟢 no" if g.get("is_kernel_ac") is False else "—"
                )
                players = g.get("current_players", "N/A") or "N/A"
                link = g.get("link", "#")
                f.write(
                    f"| {rank} | {name} | {genre} | {kernel} | {players} "
                    f"| [Steam]({link}) |\n"
                )
            f.write("\n")

    print(f"OK -> {path}")
    print(f"   {total_games} games across {len(canonical_order)} AC families")
    if unrecognised:
        print(f"\nWARN: {len(unrecognised)} games have unrecognised AC strings:")
        for name, ac in unrecognised[:10]:
            print(f"  - {name}: {ac!r}")
        if len(unrecognised) > 10:
            print(f"  ... and {len(unrecognised) - 10} more")


if __name__ == "__main__":
    main()
