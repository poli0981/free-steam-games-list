#!/usr/bin/env python3
"""Mark online games >1 year old with current_players=0 for ≥N days as dead.

Logic:
  - Only games with status="active" and type_game="online" are considered.
    Single-player games legitimately have 0 concurrent players.
  - Only games released >1 year ago — avoids false positives for new games
    in their early-adoption phase.
  - First time we observe 0 players → set zero_player_since timestamp.
  - Once `now - zero_player_since >= DEAD_GAME_DAYS`, set is_dead=True and
    append "💀 Dead game" to notes (idempotent).
  - When players come back, clear zero_player_since (but is_dead persists
    until manually unset — recovery is rare and human-judgement worthy).

Usage:
  python scripts/mark_dead_games.py [--dry-run] [--days N]

Env:
  DEAD_GAME_DAYS  default threshold (overridden by --days)
"""
import sys, os, argparse, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from datetime import datetime, timedelta, timezone
from core.data_store import (
    load_main, save_main, now_iso, append_note_idempotent,
)

DEAD_LOG = "scripts/dead_games.log"
DEFAULT_DAYS = int(os.environ.get("DEAD_GAME_DAYS", "14"))
DEAD_MARKER = "💀 Dead game"

# Steam release_date formats: "22 Aug, 2012", "Dec 19, 2025", "2025",
# "Coming Soon", "TBA", "" — must handle all gracefully.
_DATE_FORMATS = ["%d %b, %Y", "%b %d, %Y", "%Y-%m-%d", "%Y"]
_PLACEHOLDERS = {"coming soon", "tba", "to be announced", "n/a", ""}


def parse_release(s: str):
    if not s or s.strip().lower() in _PLACEHOLDERS:
        return None
    s = s.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def parse_players(s) -> int:
    if s is None:
        return 0
    if isinstance(s, (int, float)):
        return int(s)
    digits = re.sub(r"[^\d]", "", str(s))
    return int(digits) if digits else 0


def parse_iso(s: str):
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="Print decisions without writing")
    ap.add_argument("--days", type=int, default=DEFAULT_DAYS,
                    help=f"Threshold in days (default {DEFAULT_DAYS})")
    args = ap.parse_args()

    games = load_main()
    now = datetime.now(timezone.utc)
    one_year_ago = now - timedelta(days=365)
    threshold = timedelta(days=args.days)

    started, marked, cleared, skipped = [], [], [], 0

    for g in games:
        if g.get("status") != "active" or g.get("type_game") != "online":
            skipped += 1
            continue
        rel = parse_release(g.get("release_date", ""))
        if rel is None or rel > one_year_ago:
            # New / unparseable release date → reset streak, leave alone.
            if g.get("zero_player_since"):
                g["zero_player_since"] = ""
            skipped += 1
            continue

        players = parse_players(g.get("current_players"))

        if players > 0:
            if g.get("zero_player_since"):
                g["zero_player_since"] = ""
                cleared.append(g.get("name", "?"))
            continue

        # players == 0
        since_dt = parse_iso(g.get("zero_player_since", ""))
        if since_dt is None:
            g["zero_player_since"] = now_iso()
            g["last_updated"] = now_iso()
            started.append(g.get("name", "?"))
            continue

        if now - since_dt < threshold:
            continue

        if not g.get("is_dead"):
            note = f"{DEAD_MARKER} (no players ≥{args.days}d)"
            if append_note_idempotent(g, DEAD_MARKER, note):
                g["is_dead"] = True
                g["last_updated"] = now_iso()
                marked.append(g.get("name", "?"))

    print(
        f"Scanned {len(games)} | skipped {skipped} | "
        f"started-streak {len(started)} | cleared-streak {len(cleared)} | "
        f"marked-dead {len(marked)}"
    )
    for n in marked:
        print(f"  💀 {n}")

    if args.dry_run:
        print("(dry-run — not writing)")
        return

    save_main(games)

    if marked:
        ts = now.strftime("%Y-%m-%d %H:%M UTC")
        with open(DEAD_LOG, "a", encoding="utf-8") as f:
            f.write(f"\n── {ts} (threshold {args.days}d) ──\n")
            for n in marked:
                f.write(f"  💀 {n}\n")


if __name__ == "__main__":
    main()
