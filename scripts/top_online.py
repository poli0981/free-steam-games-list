#!/usr/bin/env python3
"""Top online leaderboard."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from datetime import datetime, timezone
from core.constants import STEAM_API_KEY, GAMES_DIR, TOP_ONLINE_LIMIT
from core.data_store import load_main, save_main, extract_appid
from core.fetcher import update_players_only

def _ppc(s):
    c = s.replace(",","").strip()
    return int(c) if c.isdigit() else 0

_TIERS = [(100000,"🔥 Mega"),(30000,"⭐ Hot"),(10000,"🟢 Healthy"),
          (3000,"🟡 Stable"),(500,"🟠 Low"),(50,"🔴 Dying")]

def _tier(c):
    for thresh, label in _TIERS:
        if c >= thresh: return label
    return "💀 Dead"

def _trend(cur, prev):
    if prev == 0: return "🆕"
    d = ((cur - prev) / prev) * 100
    if d > 15: return f"📈+{d:.0f}%"
    if d > 3:  return f"↑+{d:.0f}%"
    if d < -15: return f"📉{d:.0f}%"
    if d < -3:  return f"↓{d:.0f}%"
    return "→"

_STAR_THRESHOLDS = [(95,"★★★★★"),(80,"★★★★☆"),(70,"★★★☆☆"),(50,"★★☆☆☆")]

def _stars(r):
    try: p = int(r.split("%")[0])
    except: return "—"
    for thresh, s in _STAR_THRESHOLDS:
        if p >= thresh: return s
    return "★☆☆☆☆"

def main():
    if not STEAM_API_KEY: print("No key."); sys.exit(1)
    games = load_main()
    online = [g for g in games if g.get("type_game","").lower()=="online"
              and g.get("status","active")=="active"]
    if not online: print("No online games."); sys.exit(1)
    print(f"{len(online)} online games...")
    prev = {}
    for g in online:
        aid = extract_appid(g.get("link",""))
        if aid: prev[aid] = _ppc(g.get("current_players","0"))
    update_players_only(games)
    # Re-filter after update (status may have changed)
    online = [g for g in games if g.get("type_game","").lower()=="online"
              and g.get("status","active")=="active"]
    online.sort(key=lambda g: _ppc(g.get("current_players","0")), reverse=True)
    tp = sum(_ppc(g.get("current_players","0")) for g in online)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    os.makedirs(GAMES_DIR, exist_ok=True)
    with open(f"{GAMES_DIR}/top-online.md", "w") as f:
        f.write(f"# 🎮 Top Online – Live Leaderboard\n\n> {now} | {len(online)} games | {tp:,} players\n\n")
        f.write("| # | Game | Players | Trend | Tier | Rating | Genre | AC | Peak | Link |\n")
        f.write("|---|------|---------|-------|------|--------|-------|----|------|------|\n")
        for rank, g in enumerate(online[:TOP_ONLINE_LIMIT], 1):
            aid = extract_appid(g.get("link",""))
            c = _ppc(g.get("current_players","0"))
            n = g.get("name","?")
            if len(n) > 40: n = n[:37] + "..."
            ac = g.get("anti_cheat","-")
            if g.get("is_kernel_ac") is True and ac != "-": ac += "🔴"
            f.write(f"| {rank} | {n} | {g.get('current_players','N/A')} "
                    f"| {_trend(c,prev.get(aid,0))} | {_tier(c)} | {_stars(g.get('reviews','N/A'))} "
                    f"| {g.get('genre','N/A')} | {ac} | {g.get('peak_today','N/A')} "
                    f"| [Steam]({g.get('link','#')}) |\n")
        rest = online[TOP_ONLINE_LIMIT:]
        if rest:
            dead = sum(1 for g in rest if _ppc(g.get("current_players","0")) < 50)
            f.write(f"\n*+{len(rest)} more ({dead} <50 players)*\n")
    save_main(games)
    print(f"✓ → {GAMES_DIR}/top-online.md")

if __name__ == "__main__": main()
