#!/usr/bin/env python3
"""
Generate markdown tables v2.1.

New columns: Platforms, Languages, Publisher.
Uses enriched data from extension when available.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from collections import defaultdict
from datetime import datetime, timezone

from core.constants import GAMES_DIR, MAX_GAMES_PER_FILE
from core.data_store import load_main


# ──────────── Utils ────────────

def short_desc(full, max_len=120):
    if not full or full in ("N/A", ""): return "N/A"
    s = full.split(".")[0].strip()
    text = (s + ".") if s else full
    return text[:max_len] + "..." if len(text) > max_len else text

def trunc(name, max_len=45):
    return name if len(name) <= max_len else name[:max_len-3] + "..."

def review_key(g):
    raw = g.get("reviews", "N/A")
    if "N/A" in raw or "No reviews" in raw: return 0
    try: return int(raw.split("%")[0])
    except: return 0

def status_icon(g):
    s = g.get("status", "active")
    if s == "delisted": return "💀"
    if "No longer free" in g.get("notes", ""): return "💰"
    return "✅"

def fmt_list(val, max_items=3):
    """Format a list field for table display."""
    if not val or not isinstance(val, list): return "-"
    if len(val) <= max_items:
        return ", ".join(str(v) for v in val)
    return ", ".join(str(v) for v in val[:max_items]) + f" +{len(val)-max_items}"

def fmt_dev(val):
    if isinstance(val, list):
        return ", ".join(val) if val else "N/A"
    return val or "N/A"

# ──────────── Table ────────────

HEADER = (
    "| # | Thumb | Game | Genre | Developer | Publisher | Released | "
    "Platforms | Languages | Reviews | Players | Anti-Cheat | "
    "Metacritic | Status | Description | Link | Notes |\n"
    "|---|-------|------|-------|-----------|-----------|----------|"
    "----------|-----------|---------|---------|------------|"
    "-----------|--------|-------------|------|-------|\n"
)

def make_row(idx, g):
    name = trunc(g.get("name", "Unknown"))
    img = g.get("header_image", "")
    thumb = f"<img src='{img}' width='120'>" if img and "placeholder" not in img else "-"

    dev = fmt_dev(g.get("developer", "N/A"))
    pub = fmt_dev(g.get("publisher", []))
    plat = fmt_list(g.get("platforms", []))
    langs = g.get("languages", [])
    lang_str = f"{len(langs)} langs" if len(langs) > 3 else fmt_list(langs)

    ac = g.get("anti_cheat", "-")
    ac_note = g.get("anti_cheat_note", "")
    if g.get("is_kernel_ac") is True and ac != "-":
        ac += " 🔴"  # kernel-level warning
    elif g.get("is_kernel_ac") is False and ac != "-":
        ac += " 🟢"  # non-kernel

    cols = [
        str(idx), thumb, name,
        g.get("genre", "N/A"), dev, pub,
        g.get("release_date", "N/A"), plat, lang_str,
        g.get("reviews", "N/A"), g.get("current_players", "N/A"),
        ac, g.get("metacritic", "N/A"),
        status_icon(g),
        short_desc(g.get("description", "N/A")),
        f"[Steam]({g.get('link', '#')})",
        g.get("notes", ""),
    ]
    return "| " + " | ".join(cols) + " |\n"


def main():
    games = load_main()
    print(f"Loaded {len(games)} games – generating tables...")
    games.sort(key=review_key, reverse=True)
    os.makedirs(GAMES_DIR, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # All games (partitioned)
    total = len(games)
    num_parts = (total + MAX_GAMES_PER_FILE - 1) // MAX_GAMES_PER_FILE
    part_files = []

    for part in range(1, num_parts + 1):
        start = (part - 1) * MAX_GAMES_PER_FILE
        end = min(part * MAX_GAMES_PER_FILE, total)
        chunk = games[start:end]
        lines = [
            f"# All Free-to-Play Games (Part {part}/{num_parts})\n\n",
            f"Games {start+1}–{end} of {total} · Generated: {now}\n\n",
            HEADER,
        ]
        for i, g in enumerate(chunk, start + 1):
            lines.append(make_row(i, g))
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
        glist.sort(key=review_key, reverse=True)
        safe = genre.lower().replace(" ", "-").replace("/", "-").replace(",", "")
        fname = f"{safe}.md"
        lines = [f"# {genre} Games\n\n", f"{len(glist)} games · Generated: {now}\n\n", HEADER]
        for i, g in enumerate(glist, 1):
            lines.append(make_row(i, g))
        with open(f"{GAMES_DIR}/{fname}", "w", encoding="utf-8") as f:
            f.writelines(lines)
        genre_files.append((genre, fname, len(glist)))

    # README index
    with open(f"{GAMES_DIR}/README.md", "w", encoding="utf-8") as f:
        f.write("# 🎮 Steam Free-to-Play Game Tracker\n\n")
        f.write(f"**Total games:** {total} · **Last updated:** {now}\n\n")
        f.write("## 📋 Full List\n\n")
        for pf in part_files:
            f.write(f"- [{pf}]({pf})\n")
        f.write("\n## 🏷️ By Genre\n\n| Genre | Games | File |\n|-------|-------|------|\n")
        for genre, fname, count in genre_files:
            f.write(f"| {genre} | {count} | [{fname}]({fname}) |\n")
        f.write(f"\n## 🏆 Online Leaderboard\n\n- [top-online.md](top-online.md)\n")

    print(f"✓ {len(part_files)} all-games, {len(genre_files)} genre files, README index.")


if __name__ == "__main__":
    main()
