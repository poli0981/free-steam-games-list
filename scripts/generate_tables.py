#!/usr/bin/env python3
"""
Generate markdown tables from data.jsonl.

Outputs:
  - games/all-games.md (or partitioned if >200)
  - games/<genre>.md per genre
  - games/README.md index file
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from collections import defaultdict
from datetime import datetime, timezone

from core.constants import GAMES_DIR, MAX_GAMES_PER_FILE
from core.data_store import load_main, extract_appid

import jsonlines  # only used via core, but ensure available


# ──────────── Utils ────────────

def short_desc(full: str, max_len: int = 120) -> str:
    if not full or full == "N/A":
        return "N/A"
    sentence = full.split(".")[0].strip()
    if sentence:
        text = sentence + "."
    else:
        text = full
    return text[:max_len] + "..." if len(text) > max_len else text


def truncate_name(name: str, max_len: int = 45) -> str:
    if len(name) <= max_len:
        return name
    return name[:max_len - 3] + "..."


def review_sort_key(game: dict) -> int:
    raw = game.get("reviews", "N/A")
    if "N/A" in raw or "No reviews" in raw:
        return 0
    try:
        return int(raw.split("%")[0])
    except (ValueError, IndexError):
        return 0


def status_icon(game: dict) -> str:
    s = game.get("status", "active")
    if s == "delisted":
        return "💀"
    if "No longer free" in game.get("notes", ""):
        return "💰"
    return "✅"


# ──────────── Table building ────────────

HEADER = (
    "| # | Thumbnail | Game | Genre | Developer | Released | Metacritic | "
    "Reviews | Players | Anti-Cheat | DRM | Status | Description | Link | Notes |\n"
    "|---|-----------|------|-------|-----------|----------|------------|"
    "---------|---------|------------|-----|--------|-------------|------|------|\n"
)


def make_row(idx: int, g: dict) -> str:
    name = truncate_name(g.get("name", "Unknown"))
    img = g.get("header_image", "https://via.placeholder.com/460x215?text=No+Image")
    thumb = f"<img src='{img}' width='120'>"
    mc = g.get("metacritic", "N/A")
    drm = g.get("drm_notes", "-")
    if len(drm) > 30:
        drm = drm[:27] + "..."

    cols = [
        str(idx),
        thumb,
        name,
        g.get("genre", "N/A"),
        g.get("developer", "N/A"),
        g.get("release_date", "N/A"),
        mc,
        g.get("reviews", "N/A"),
        g.get("current_players", "N/A"),
        g.get("anti_cheat", "-"),
        drm,
        status_icon(g),
        short_desc(g.get("desc", "N/A")),
        f"[Steam]({g.get('link', '#')})",
        g.get("notes", ""),
    ]
    return "| " + " | ".join(cols) + " |\n"


# ──────────── Main ────────────

def main():
    games = load_main()
    print(f"Loaded {len(games)} games – generating tables...")

    # Sort by review score descending
    games.sort(key=review_sort_key, reverse=True)

    os.makedirs(GAMES_DIR, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # ── All games (partitioned) ──
    total = len(games)
    num_parts = (total + MAX_GAMES_PER_FILE - 1) // MAX_GAMES_PER_FILE
    part_files: list[str] = []

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
        path = f"{GAMES_DIR}/{fname}"
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        part_files.append(fname)

    # ── Per-genre tables ──
    genres: dict[str, list[dict]] = defaultdict(list)
    for g in games:
        genres[g.get("genre", "Uncategorized")].append(g)

    genre_files: list[tuple[str, str, int]] = []
    for genre, glist in sorted(genres.items()):
        glist.sort(key=review_sort_key, reverse=True)
        safe = genre.lower().replace(" ", "-").replace("/", "-").replace(",", "")
        fname = f"{safe}.md"

        lines = [
            f"# {genre} Games\n\n",
            f"{len(glist)} games · Generated: {now}\n\n",
            HEADER,
        ]
        for i, g in enumerate(glist, 1):
            lines.append(make_row(i, g))

        with open(f"{GAMES_DIR}/{fname}", "w", encoding="utf-8") as f:
            f.writelines(lines)
        genre_files.append((genre, fname, len(glist)))

    # ── README index ──
    with open(f"{GAMES_DIR}/README.md", "w", encoding="utf-8") as f:
        f.write("# 🎮 Steam Free-to-Play Game Tracker\n\n")
        f.write(f"**Total games:** {total} · **Last updated:** {now}\n\n")
        f.write("## 📋 Full List\n\n")
        for pf in part_files:
            f.write(f"- [{pf}]({pf})\n")
        f.write("\n## 🏷️ By Genre\n\n")
        f.write("| Genre | Games | File |\n|-------|-------|------|\n")
        for genre, fname, count in genre_files:
            f.write(f"| {genre} | {count} | [{fname}]({fname}) |\n")
        f.write(f"\n## 🏆 Online Leaderboard\n\n- [top-online.md](top-online.md)\n")

    print(f"✓ Generated {len(part_files)} all-games file(s), "
          f"{len(genre_files)} genre files, and README index.")


if __name__ == "__main__":
    main()
