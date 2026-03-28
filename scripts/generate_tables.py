#!/usr/bin/env python3
"""Generate markdown tables v2.1."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from collections import defaultdict
from datetime import datetime, timezone
from core.constants import GAMES_DIR, MAX_GAMES_PER_FILE
from core.data_store import load_main


def _review_pct(g):
    """Extract review percentage for sorting. Cache-friendly."""
    raw = g.get("reviews", "N/A")
    if "N/A" in raw or "No reviews" in raw:
        return 0
    try:
        return int(raw.split("%")[0])
    except (ValueError, IndexError):
        return 0


def _trunc(s, n=45):
    return s if len(s) <= n else s[:n-3] + "..."


def _fmt_list(val, max_items=3):
    if not val or not isinstance(val, list):
        return "-"
    if len(val) <= max_items:
        return ", ".join(str(v) for v in val)
    return ", ".join(str(v) for v in val[:max_items]) + f" +{len(val)-max_items}"


def _fmt_dev(val):
    if isinstance(val, list):
        return ", ".join(val) if val else "N/A"
    return val or "N/A"


def _status(g):
    if g.get("status") == "delisted": return "💀"
    if "No longer free" in g.get("notes", ""): return "💰"
    return "✅"


def _short_desc(full, max_len=120):
    if not full or full in ("N/A", ""):
        return "N/A"
    s = full.split(".")[0].strip()
    text = (s + ".") if s else full
    return text[:max_len] + "..." if len(text) > max_len else text


HEADER = (
    "| # | Thumb | Game | Genre | Developer | Publisher | Released | "
    "Platforms | Languages | Reviews | Players | Anti-Cheat | "
    "Metacritic | Status | Description | Link | Notes |\n"
    "|---|-------|------|-------|-----------|-----------|----------|"
    "----------|-----------|---------|---------|------------|"
    "-----------|--------|-------------|------|-------|\n"
)


def _row(idx, g):
    name = _trunc(g.get("name", "Unknown"))
    img = g.get("header_image", "")
    thumb = f"<img src='{img}' width='120'>" if img and "placeholder" not in img else "-"
    langs = g.get("languages", [])
    lang_str = f"{len(langs)} langs" if len(langs) > 3 else _fmt_list(langs)
    ac = g.get("anti_cheat", "-")
    if g.get("is_kernel_ac") is True and ac != "-":
        ac += " 🔴"
    elif g.get("is_kernel_ac") is False and ac != "-":
        ac += " 🟢"

    parts = [
        str(idx), thumb, name,
        g.get("genre", "N/A"),
        _fmt_dev(g.get("developer", "N/A")),
        _fmt_dev(g.get("publisher", [])),
        g.get("release_date", "N/A"),
        _fmt_list(g.get("platforms", [])),
        lang_str,
        g.get("reviews", "N/A"),
        g.get("current_players", "N/A"),
        ac,
        g.get("metacritic", "N/A"),
        _status(g),
        _short_desc(g.get("description", "N/A")),
        f"[Steam]({g.get('link', '#')})",
        g.get("notes", ""),
    ]
    return "| " + " | ".join(parts) + " |\n"


def main():
    games = load_main()
    print(f"Loaded {len(games)} games...")

    # Sort once with cached key
    games.sort(key=_review_pct, reverse=True)

    os.makedirs(GAMES_DIR, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    total = len(games)
    num_parts = (total + MAX_GAMES_PER_FILE - 1) // MAX_GAMES_PER_FILE
    part_files = []

    for part in range(1, num_parts + 1):
        start = (part - 1) * MAX_GAMES_PER_FILE
        end = min(part * MAX_GAMES_PER_FILE, total)
        lines = [
            f"# All Free-to-Play Games (Part {part}/{num_parts})\n\n",
            f"Games {start+1}–{end} of {total} · Generated: {now}\n\n",
            HEADER,
        ]
        lines.extend(_row(i, games[i-1]) for i in range(start+1, end+1))
        fname = f"all-games_part{part}.md" if num_parts > 1 else "all-games.md"
        with open(f"{GAMES_DIR}/{fname}", "w", encoding="utf-8") as f:
            f.writelines(lines)
        part_files.append(fname)

    # Genre tables
    genres = defaultdict(list)
    for g in games:
        genres[g.get("genre", "Uncategorized")].append(g)

    genre_files = []
    for genre, glist in sorted(genres.items()):
        glist.sort(key=_review_pct, reverse=True)
        safe = genre.lower().replace(" ", "-").replace("/", "-").replace(",", "")
        fname = f"{safe}.md"
        lines = [f"# {genre} Games\n\n", f"{len(glist)} games · {now}\n\n", HEADER]
        lines.extend(_row(i, g) for i, g in enumerate(glist, 1))
        with open(f"{GAMES_DIR}/{fname}", "w", encoding="utf-8") as f:
            f.writelines(lines)
        genre_files.append((genre, fname, len(glist)))

    # Index
    with open(f"{GAMES_DIR}/README.md", "w", encoding="utf-8") as f:
        f.write(f"# 🎮 Steam F2P Tracker\n\n**{total} games** · {now}\n\n")
        f.write("## 📋 Full List\n\n")
        for pf in part_files:
            f.write(f"- [{pf}]({pf})\n")
        f.write("\n## 🏷️ By Genre\n\n| Genre | # | File |\n|-------|---|------|\n")
        for genre, fname, count in genre_files:
            f.write(f"| {genre} | {count} | [{fname}]({fname}) |\n")
        f.write("\n## 🏆 Leaderboard\n\n- [top-online.md](top-online.md)\n")

    print(f"✓ {len(part_files)} all-games, {len(genre_files)} genres, README.")


if __name__ == "__main__":
    main()
