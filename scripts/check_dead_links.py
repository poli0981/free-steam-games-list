#!/usr/bin/env python3
"""Lightweight dead link checker (HEAD requests)."""
import sys, os, random, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from datetime import datetime, timezone
from core.constants import DEAD_LINKS_LOG, BATCH_SIZE, BATCH_PAUSE_MIN, BATCH_PAUSE_MAX
from core.data_store import load_main, save_main, extract_appid, now_iso
from core.steam_client import get_client

def main():
    games = load_main()
    active = [g for g in games if g.get("status", "active") == "active"]
    print(f"Checking {len(active)} active games...\n")
    client = get_client()
    dead = []
    total = len(active)
    for bs in range(0, total, BATCH_SIZE):
        be = min(bs + BATCH_SIZE, total)
        print(f"── Batch {bs//BATCH_SIZE+1} ──")
        for i in range(bs, be):
            g = active[i]
            appid = extract_appid(g.get("link", ""))
            name = g.get("name", appid or "?")
            if not appid: continue
            code = client.check_store_page(appid)
            if code in (404, 410):
                print(f"  [{i+1}/{total}] 💀 ({code}): {name}")
                g["status"] = "delisted"
                g["notes"] = (g.get("notes","") + f" 💀 Delisted ({code})").strip()
                g["last_updated"] = now_iso()
                dead.append({"name": name, "appid": appid, "code": code})
            elif code == 200:
                print(f"  [{i+1}/{total}] ✓ {name[:50]}")
            else:
                print(f"  [{i+1}/{total}] ⚠ {code}: {name[:50]}")
        if be < total:
            p = random.uniform(BATCH_PAUSE_MIN, BATCH_PAUSE_MAX)
            print(f"  ⏳ {p:.0f}s...\n")
            time.sleep(p)
    save_main(games)
    if dead:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        with open(DEAD_LINKS_LOG, "a") as f:
            f.write(f"\n── {ts} ──\n")
            for d in dead: f.write(f"  [{d['code']}] {d['name']} ({d['appid']})\n")
        print(f"\n💀 {len(dead)} dead links logged")
    else:
        print(f"\n✓ All {total} alive!")

if __name__ == "__main__": main()
