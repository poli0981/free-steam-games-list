#!/usr/bin/env python3
"""Top offline (single-player / non-online) leaderboard.

Mirrors top_online.py but filters games whose `type_game` is NOT "online".
Steam reports concurrent player counts for offline titles too — single-player
hits, demos, story games can still rack up concurrents during sales or
patch days, so this leaderboard surfaces what's actually being played
beyond the always-online crowd.

Output: games/top-offline.md (10 columns, same shape as top-online.md).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from datetime import datetime, timezone
from core.constants import STEAM_API_KEY, GAMES_DIR, TOP_OFFLINE_LIMIT
from core.data_store import load_main, save_main, extract_appid
from core.fetcher import update_players_only

def _ppc(s):
    c = s.replace(",", "").strip()
    return int(c) if c.isdigit() else 0

# Tiers calibrated lower than top-online — offline games rarely hit
# 6-figure concurrents, so the same scale would flatten everything to 💀.
_TIERS = [(20000, "🔥 Mega"), (5000, "⭐ Hot"), (1500, "🟢 Healthy"),
          (300, "🟡 Stable"), (50, "🟠 Low"), (10, "🔴 Quiet")]

def _tier(c):
    for thresh, label in _TIERS:
        if c >= thresh: return label
    return "💀 Idle"

def _trend(cur, prev):
    if prev == 0: return "🆕"
    d = ((cur - prev) / prev) * 100
    if d > 15: return f"📈+{d:.0f}%"
    if d > 3:  return f"↑+{d:.0f}%"
    if d < -15: return f"📉{d:.0f}%"
    if d < -3:  return f"↓{d:.0f}%"
    return "→"

_STAR_THRESHOLDS = [(95, "★★★★★"), (80, "★★★★☆"), (70, "★★★☆☆"), (50, "★★☆☆☆")]

def _stars(r):
    try: p = int(r.split("%")[0])
    except: return "—"
    for thresh, s in _STAR_THRESHOLDS:
        if p >= thresh: return s
    return "★☆☆☆☆"

def _is_offline(g):
    t = g.get("type_game", "").lower()
    # Treat anything that isn't explicitly online as offline. Empty
    # type_game is excluded — those are unclassified, not offline.
    return t and t != "online"

def main():
    if not STEAM_API_KEY:
        print("No Steam API key (set STEAM_API_KEY).")
        sys.exit(1)
    games = load_main()
    offline = [g for g in games if _is_offline(g) and g.get("status", "active") == "active"]
    if not offline:
        print("No offline games found.")
        sys.exit(1)
    print(f"{len(offline)} offline games to refresh...")
    prev = {}
    for g in offline:
        aid = extract_appid(g.get("link", ""))
        if aid: prev[aid] = _ppc(g.get("current_players", "0"))
    update_players_only(games)
    # Re-filter after update (status may have changed).
    offline = [g for g in games if _is_offline(g) and g.get("status", "active") == "active"]
    offline.sort(key=lambda g: _ppc(g.get("current_players", "0")), reverse=True)
    tp = sum(_ppc(g.get("current_players", "0")) for g in offline)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    os.makedirs(GAMES_DIR, exist_ok=True)
    with open(f"{GAMES_DIR}/top-offline.md", "w") as f:
        f.write(f"# 🎮 Top Offline – Single-Player Leaderboard\n\n")
        f.write(f"> {now} | {len(offline)} offline games | {tp:,} concurrent players\n\n")
        f.write("Free-to-play Steam games where `type_game` is set to anything other "
                "than `online` (typically single-player, demos, or story-driven titles). "
                "Refreshed bi-weekly via `top-offline.yml`.\n\n")
        f.write("| # | Game | Players | Trend | Tier | Rating | Genre | AC | Peak | Link |\n")
        f.write("|---|------|---------|-------|------|--------|-------|----|------|------|\n")
        for rank, g in enumerate(offline[:TOP_OFFLINE_LIMIT], 1):
            aid = extract_appid(g.get("link", ""))
            c = _ppc(g.get("current_players", "0"))
            n = g.get("name", "?")
            if len(n) > 40: n = n[:37] + "..."
            ac = g.get("anti_cheat", "-")
            if g.get("is_kernel_ac") is True and ac != "-": ac += "🔴"
            f.write(f"| {rank} | {n} | {g.get('current_players', 'N/A')} "
                    f"| {_trend(c, prev.get(aid, 0))} | {_tier(c)} | {_stars(g.get('reviews', 'N/A'))} "
                    f"| {g.get('genre', 'N/A')} | {ac} | {g.get('peak_today', 'N/A')} "
                    f"| [Steam]({g.get('link', '#')}) |\n")
        rest = offline[TOP_OFFLINE_LIMIT:]
        if rest:
            quiet = sum(1 for g in rest if _ppc(g.get("current_players", "0")) < 10)
            f.write(f"\n*+{len(rest)} more ({quiet} <10 players)*\n")
    save_main(games)
    print(f"✓ → {GAMES_DIR}/top-offline.md")

if __name__ == "__main__": main()
