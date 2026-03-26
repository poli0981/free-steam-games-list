#!/usr/bin/env python3
"""Top online leaderboard with trends."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from datetime import datetime, timezone
from collections import Counter
from core.constants import STEAM_API_KEY, GAMES_DIR, TOP_ONLINE_LIMIT
from core.data_store import load_main, save_main, extract_appid
from core.fetcher import update_players_only

def ppc(raw): c=raw.replace(",","").strip(); return int(c) if c.isdigit() else 0
def tier(c):
    if c>=100000: return "🔥 Mega"
    if c>=30000: return "⭐ Hot"
    if c>=10000: return "🟢 Healthy"
    if c>=3000: return "🟡 Stable"
    if c>=500: return "🟠 Low"
    if c>=50: return "🔴 Dying"
    return "💀 Dead"
def trend(cur,prev):
    if prev==0: return "🆕"
    d=((cur-prev)/prev)*100
    if d>15: return f"📈 +{d:.0f}%"
    if d>3: return f"↑ +{d:.0f}%"
    if d<-15: return f"📉 {d:.0f}%"
    if d<-3: return f"↓ {d:.0f}%"
    return "→"
def stars(r):
    try: p=int(r.split("%")[0])
    except: return "—"
    if p>=95: return "★★★★★"
    if p>=80: return "★★★★☆"
    if p>=70: return "★★★☆☆"
    if p>=50: return "★★☆☆☆"
    return "★☆☆☆☆"

def main():
    if not STEAM_API_KEY: print("No key."); sys.exit(1)
    games = load_main()
    online = [g for g in games if g.get("type_game","").lower()=="online" and g.get("status","active")=="active"]
    if not online: print("No online games."); sys.exit(1)
    print(f"{len(online)} online games...")
    prev = {extract_appid(g.get("link","")): ppc(g.get("current_players","0")) for g in online if extract_appid(g.get("link",""))}
    update_players_only(games)
    online = [g for g in games if g.get("type_game","").lower()=="online" and g.get("status","active")=="active"]
    online.sort(key=lambda g: ppc(g.get("current_players","0")), reverse=True)
    tp = sum(ppc(g.get("current_players","0")) for g in online)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    os.makedirs(GAMES_DIR, exist_ok=True)
    with open(f"{GAMES_DIR}/top-online.md","w") as f:
        f.write(f"# 🎮 Top Online Games – Live Leaderboard\n\n> Updated: {now} | {len(online)} games | {tp:,} players\n\n")
        f.write("| Rank | Game | Players | Trend | Tier | Rating | Genre | AC | Peak | Link |\n")
        f.write("|------|------|---------|-------|------|--------|-------|----|------|------|\n")
        for rank,g in enumerate(online[:TOP_ONLINE_LIMIT],1):
            aid = extract_appid(g.get("link",""))
            c = ppc(g.get("current_players","0"))
            n = g.get("name","?"); n = n[:37]+"..." if len(n)>40 else n
            ac = g.get("anti_cheat","-")
            if g.get("is_kernel_ac") is True and ac != "-": ac += " 🔴"
            f.write(f"| {rank} | {n} | {g.get('current_players','N/A')} | {trend(c,prev.get(aid,0))} | {tier(c)} | {stars(g.get('reviews','N/A'))} | {g.get('genre','N/A')} | {ac} | {g.get('peak_today','N/A')} | [Steam]({g.get('link','#')}) |\n")
        rest = online[TOP_ONLINE_LIMIT:]
        if rest:
            dead = sum(1 for g in rest if ppc(g.get("current_players","0"))<50)
            f.write(f"\n*+{len(rest)} more ({dead} with <50 players)*\n")
    save_main(games)
    print(f"✓ Leaderboard → {GAMES_DIR}/top-online.md")

if __name__ == "__main__": main()
