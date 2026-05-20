#!/usr/bin/env python3
"""Generate markdown tables v2.4 — drops per-genre files (v3.2.5).

Per-genre `<genre>.md` files were removed in v3.2.5 — the web app at
/games?genre=X is the canonical filter UI now. We only regenerate
`all-games_part*.md` + the index `README.md`. Top leaderboards and the
AC list have their own scripts.

Smart regen via `.gen-hash`: if game data (link/name/genre/reviews/
players/AC/status) hasn't changed since the last run, skip generation
entirely. This cuts daily commit spam on the catalogue when the
underlying data is stable.
"""
import sys, os, hashlib, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime, timezone
from core.constants import GAMES_DIR, MAX_GAMES_PER_FILE
from core.data_store import load_main


# Hash file lives inside games/ so it commits alongside the regenerated
# markdown — the workflow bot picks up both atomically.
_HASH_FILE = os.path.join(GAMES_DIR, ".gen-hash")


def _content_hash(games):
    """Hash the fields that actually affect rendered MD output. Sorting
    makes the digest order-invariant so reshuffles inside data shards
    don't trigger spurious regen."""
    slim = [(
        g.get("link"), g.get("name"), g.get("genre"),
        g.get("reviews"), g.get("current_players"),
        g.get("anti_cheat"), g.get("is_kernel_ac"),
        g.get("status"),
    ) for g in games]
    slim.sort()
    return hashlib.sha256(
        json.dumps(slim, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


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


def _to_capsule(url: str) -> str:
    """Steam header.jpg → capsule_184x69.jpg (~10 KB instead of ~50 KB).

    GitHub renders these at 120 px width; the smaller capsule is plenty.
    Falls back to the original URL when the filename doesn't match.
    """
    if not url or "header.jpg" not in url:
        return url
    return url.replace("header.jpg", "capsule_184x69.jpg")


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
    thumb_url = _to_capsule(img)
    thumb = f"<img src='{thumb_url}' width='120' loading='lazy'>" if img and "placeholder" not in img else "-"
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

    # Smart regen — skip if semantic content unchanged since last run.
    # Spares ~80% of daily commits on a stable catalogue.
    os.makedirs(GAMES_DIR, exist_ok=True)
    new_hash = _content_hash(games)
    if os.path.isfile(_HASH_FILE):
        try:
            with open(_HASH_FILE, encoding="utf-8") as f:
                old_hash = f.read().strip()
            if old_hash == new_hash:
                print(f"Skip: no semantic changes (hash={new_hash[:12]})")
                return
        except OSError:
            pass  # corrupt/missing file — proceed with regen

    # Sort once with cached key
    games.sort(key=_review_pct, reverse=True)

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

    # Index — points at part files + leaderboards + AC list.
    # Per-genre browse moved to the web app (/games?genre=X) in v3.2.5.
    with open(f"{GAMES_DIR}/README.md", "w", encoding="utf-8") as f:
        f.write(f"# Steam F2P Tracker\n\n**{total} games** · {now}\n\n")
        f.write("## Full list\n\n")
        for pf in part_files:
            f.write(f"- [{pf}]({pf})\n")
        f.write("\n## Leaderboards\n\n")
        f.write("- [top-online.md](top-online.md)\n")
        f.write("- [top-offline.md](top-offline.md)\n")
        f.write("- [anti-cheat-list.md](anti-cheat-list.md)\n")
        f.write("\n## By genre\n\n")
        f.write("Genre filtering moved to the web app: "
                "<https://poli0981.github.io/free-steam-games-list/#/games> "
                "(click any genre badge or use the genre filter dropdown).\n")

    # Persist hash so the next run can short-circuit.
    with open(_HASH_FILE, "w", encoding="utf-8") as f:
        f.write(new_hash + "\n")

    print(f"OK: {len(part_files)} all-games files + README (hash={new_hash[:12]})")


if __name__ == "__main__":
    main()
