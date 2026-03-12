#!/usr/bin/env python3
"""
Top Online Games Leaderboard – upgraded.

Features:
  - Fresh player counts via API key
  - Trend arrows (↑↓→) comparing current vs previous snapshot
  - Tier badges based on population
  - Peak-today tracking
  - Genre & anti-cheat breakdown stats
  - Markdown output with summary stats at top
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime, timezone
from collections import Counter

from core.constants import STEAM_API_KEY, GAMES_DIR, TOP_ONLINE_LIMIT
from core.data_store import load_main, save_main, extract_appid
from core.fetcher import update_players_only


# ──────────── Helpers ────────────

def parse_player_count(raw: str) -> int:
    """Convert '12,345' or 'N/A' to int."""
    clean = raw.replace(",", "").strip()
    return int(clean) if clean.isdigit() else 0


def tier_badge(count: int) -> str:
    """Assign a tier based on concurrent players."""
    if count >= 100_000: return "🔥 Mega"
    if count >= 30_000:  return "⭐ Hot"
    if count >= 10_000:  return "🟢 Healthy"
    if count >= 3_000:   return "🟡 Stable"
    if count >= 500:     return "🟠 Low"
    if count >= 50:      return "🔴 Dying"
    return "💀 Dead"


def trend_arrow(current: int, previous: int) -> str:
    """Show trend compared to last snapshot."""
    if previous == 0:
        return "🆕"
    diff_pct = ((current - previous) / previous) * 100
    if diff_pct > 15:   return f"📈 +{diff_pct:.0f}%"
    if diff_pct > 3:    return f"↑ +{diff_pct:.0f}%"
    if diff_pct < -15:  return f"📉 {diff_pct:.0f}%"
    if diff_pct < -3:   return f"↓ {diff_pct:.0f}%"
    return "→ stable"


def review_stars(review_str: str) -> str:
    """Convert '85% (Very Positive)' to star rating."""
    try:
        pct = int(review_str.split("%")[0])
    except (ValueError, IndexError):
        return "—"
    if pct >= 95: return "★★★★★"
    if pct >= 80: return "★★★★☆"
    if pct >= 70: return "★★★☆☆"
    if pct >= 50: return "★★☆☆☆"
    if pct >= 30: return "★☆☆☆☆"
    return "☆☆☆☆☆"


# ──────────── Main ────────────

def main():
    if not STEAM_API_KEY:
        print("No STEAM_API_KEY – cannot generate live top-online leaderboard.")
        sys.exit(1)

    games = load_main()
    online = [g for g in games if g.get("type_game", "").lower() == "online"
              and g.get("status", "active") == "active"]

    if not online:
        print("No online games found in data.jsonl")
        sys.exit(1)

    print(f"Found {len(online)} online games – fetching live player counts...")

    # Save previous counts for trend comparison
    prev_counts = {}
    for g in online:
        appid = extract_appid(g.get("link", ""))
        if appid:
            prev_counts[appid] = parse_player_count(g.get("current_players", "0"))

    # Fetch fresh players
    update_players_only(games)

    # Re-filter & sort
    online = [g for g in games if g.get("type_game", "").lower() == "online"
              and g.get("status", "active") == "active"]
    online.sort(key=lambda g: parse_player_count(g.get("current_players", "0")), reverse=True)

    # ── Stats for header ──
    total_players = sum(parse_player_count(g.get("current_players", "0")) for g in online)
    genre_counts = Counter(g.get("genre", "Unknown") for g in online)
    top_genres = genre_counts.most_common(5)
    ac_counts = Counter(g.get("anti_cheat", "-") for g in online)

    # ── Generate markdown ──
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    os.makedirs(GAMES_DIR, exist_ok=True)

    with open(f"{GAMES_DIR}/top-online.md", "w", encoding="utf-8") as f:
        f.write("# 🎮 Top Online / Multiplayer Games – Live Leaderboard\n\n")
        f.write(f"> **Last updated:** {now}  \n")
        f.write(f"> **Total online games:** {len(online)} | "
                f"**Total concurrent players:** {total_players:,}  \n\n")

        # Quick stats
        f.write("## 📊 Quick Stats\n\n")
        f.write("| Metric | Value |\n|--------|-------|\n")
        f.write(f"| Total games tracked | {len(online)} |\n")
        f.write(f"| Total players online | {total_players:,} |\n")
        f.write(f"| Average per game | {total_players // max(len(online), 1):,} |\n")
        tier_dist = Counter(tier_badge(parse_player_count(g.get("current_players", "0"))) for g in online)
        for tier, cnt in sorted(tier_dist.items(), key=lambda x: -x[1]):
            f.write(f"| {tier} tier | {cnt} games |\n")
        f.write("\n")

        # Genre breakdown
        f.write("**Top genres:** " + " · ".join(f"{g} ({c})" for g, c in top_genres) + "\n\n")

        # Anti-cheat breakdown
        ac_parts = [f"{k}: {v}" for k, v in ac_counts.most_common() if k != "-"]
        if ac_parts:
            f.write("**Anti-cheat:** " + " · ".join(ac_parts) + "\n\n")

        # Main table
        f.write("## 🏆 Leaderboard\n\n")
        f.write("| Rank | Game | Players | Trend | Tier | Rating | Genre | Anti-Cheat | Peak Today | Link |\n")
        f.write("|------|------|---------|-------|------|--------|-------|------------|------------|------|\n")

        shown = online[:TOP_ONLINE_LIMIT]
        for rank, g in enumerate(shown, 1):
            appid = extract_appid(g.get("link", ""))
            curr = parse_player_count(g.get("current_players", "0"))
            prev = prev_counts.get(appid, 0)
            trend = trend_arrow(curr, prev)
            tier = tier_badge(curr)
            stars = review_stars(g.get("reviews", "N/A"))
            peak = g.get("peak_today", "N/A")

            name = g.get("name", "N/A")
            if len(name) > 40:
                name = name[:37] + "..."

            f.write(
                f"| {rank} "
                f"| {name} "
                f"| {g.get('current_players', 'N/A')} "
                f"| {trend} "
                f"| {tier} "
                f"| {stars} "
                f"| {g.get('genre', 'N/A')} "
                f"| {g.get('anti_cheat', '-')} "
                f"| {peak} "
                f"| [Steam]({g.get('link', '#')}) |\n"
            )

        # Games ranked below top N
        rest = online[TOP_ONLINE_LIMIT:]
        if rest:
            dead_count = sum(1 for g in rest if parse_player_count(g.get("current_players", "0")) < 50)
            f.write(f"\n*...and {len(rest)} more games not shown ({dead_count} with <50 players)*\n")

        f.write(f"\n---\n*Data sourced live from Steam Web API. "
                f"Player counts are concurrent at time of fetch.*\n")

    # Save updated player data back
    save_main(games)
    print(f"\n✓ Leaderboard written to {GAMES_DIR}/top-online.md")


if __name__ == "__main__":
    main()
