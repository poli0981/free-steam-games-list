#!/usr/bin/env python3
"""Delete game (interactive)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.data_store import load_main, save_main, extract_appid, normalize_link

def main():
    games = load_main()
    if not games: print("Empty."); return
    q = input(f"Search ({len(games)} games): ").strip()
    if not q: return
    norm = normalize_link(q)
    tid = extract_appid(norm) if norm else (q if q.isdigit() else None)
    matches = [(i,g) for i,g in enumerate(games)
               if (tid and extract_appid(g.get("link","")) == tid)
               or q.lower() in g.get("name","").lower()]
    if not matches: print("Not found."); return
    for idx,(i,g) in enumerate(matches,1):
        print(f"  {idx}. {g.get('name','?')} ({g.get('link','?')})")
    c = input(f"Delete (1-{len(matches)}/all/q): ").strip()
    if c.lower()=="q": return
    d = ({i for i,_ in matches} if c.lower()=="all"
         else {matches[int(c)-1][0]} if c.isdigit() and 1<=int(c)<=len(matches) else set())
    if not d: print("Invalid."); return
    if input(f"Confirm {len(d)}? (y/n): ").strip().lower()!="y": return
    games = [g for i,g in enumerate(games) if i not in d]
    save_main(games)
    print(f"✓ Deleted {len(d)}. {len(games)} left.")

if __name__ == "__main__": main()
