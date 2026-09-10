#!/usr/bin/env python3
"""Daily snapshot — capture per-game time-series data.

Writes one JSONL line per game with fields needed for trend charts:
  {appid, name, current_players, peak_today, reviews_pct, captured_at}

Output: data/snapshots/YYYY-MM-DD.jsonl (one file per UTC day, idempotent — overwrites same-day).

Manual fields and full game records are NOT duplicated here; consumers join on appid
against the live shards if they need the rest.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.data_store import load_main, extract_appid

SNAPSHOTS_DIR = Path("data/snapshots")
PCT_RE = re.compile(r"(\d{1,3})%")


def _parse_players(s: str) -> int:
    if not s:
        return 0
    cleaned = s.replace(",", "").strip()
    return int(cleaned) if cleaned.isdigit() else 0


def _review_pct(reviews: str) -> int | None:
    if not reviews:
        return None
    m = PCT_RE.search(reviews)
    return int(m.group(1)) if m else None


def main() -> int:
    games = load_main()
    if not games:
        print("No games loaded — aborting snapshot.")
        return 1
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_path = SNAPSHOTS_DIR / f"{today}.jsonl"
    captured_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    written = 0
    tmp = out_path.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for g in games:
            appid = extract_appid(g.get("link", "") or "")
            if not appid:
                continue
            row = {
                "appid": appid,
                "name": g.get("name", ""),
                "current_players": _parse_players(g.get("current_players", "")),
                "peak_today": _parse_players(g.get("peak_today", "")),
                "reviews_pct": _review_pct(g.get("reviews", "")),
                "type_game": g.get("type_game", ""),
                "status": g.get("status", "active"),
                "captured_at": captured_at,
            }
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            written += 1
    tmp.replace(out_path)
    print(f"[OK] {out_path} ({written} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
