#!/usr/bin/env python3
"""Purge unhealthy games (delisted, not-free, invalid)."""
import sys, os, random, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.constants import REMOVED_JSONL, BATCH_SIZE, BATCH_PAUSE_MIN, BATCH_PAUSE_MAX
from core.data_store import load_main, save_main, load_jsonl, save_jsonl, now_iso
from core.steam_client import get_client
from core.health_checker import check_game_health, NETWORK_ERROR, OK

def main():
    games = load_main()
    if not games: print("Empty."); return
    print(f"Scanning {len(games)} games...\n")
    client = get_client()
    remove_idx, log = set(), []
    stats = {"ok": 0, "removed": 0, "network": 0}
    total = len(games)
    for bs in range(0, total, BATCH_SIZE):
        be = min(bs + BATCH_SIZE, total)
        print(f"── Batch {bs//BATCH_SIZE+1} ──")
        for i in range(bs, be):
            g = games[i]
            name = g.get("name") or g.get("link", "?")
            r = check_game_health(g.get("link",""), name, client)
            if r.is_healthy:
                print(f"  [{i+1}/{total}] ✅ {name[:50]}")
                stats["ok"] += 1
            elif r.should_remove:
                print(f"  [{i+1}/{total}] ❌ {name[:50]} → {r.reason}")
                remove_idx.add(i)
                log.append({"link":g.get("link",""),"name":r.name or name,"appid":r.appid or "","reason":r.reason,"status_code":r.status,"removed_at":now_iso()})
                stats["removed"] += 1
            else:
                print(f"  [{i+1}/{total}] ⚠ {name[:50]} (kept)")
                stats["network"] += 1
        if be < total: time.sleep(random.uniform(BATCH_PAUSE_MIN, BATCH_PAUSE_MAX))
    if remove_idx:
        cleaned = [g for i,g in enumerate(games) if i not in remove_idx]
        save_main(cleaned)
        existing = load_jsonl(REMOVED_JSONL)
        existing.extend(log)
        save_jsonl(REMOVED_JSONL, existing)
        print(f"\nPurged {len(remove_idx)}, remaining {len(cleaned)}")
    else:
        print("\nNo unhealthy games.")
    print(f"✅ {stats['ok']} | ❌ {stats['removed']} | ⚠ {stats['network']}")

if __name__ == "__main__": main()
