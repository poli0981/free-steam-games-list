[![Games Count](https://img.shields.io/badge/Games-300%2B-green?style=flat&logo=steam)](games/all-games.md)
[![Last Updated](https://img.shields.io/badge/Updated-Daily-blue?style=flat&logo=github-actions)](.github/workflows)
[![Top Online](https://img.shields.io/badge/Top%20Online-Live%20Leaderboard-red?style=flat&logo=steam)](games/top-online.md)
[![Version](https://img.shields.io/badge/version-2.0.0-purple?style=flat&logo=github)](https://github.com/poli0981/free-steam-games-list)
[![Health Check](https://img.shields.io/badge/Health%20Check-Weekly-orange?style=flat&logo=github-actions)](.github/workflows/purge-unhealthy.yml)
![Visitors](https://visitor-badge.laobi.icu/badge?page_id=poli0981.free-steam-games-list)
[![Sponsor](https://img.shields.io/badge/Sponsor-Buy%20me%20a%20coffee-ff5f5f?style=flat&logo=buy-me-a-coffee)](.github/FUNDING.yml)

A **curated list** of free-to-play games on Steam – no quality guarantees, no endorsements, just pure listings by a
broke, unemployed Vietnamese dev with too much free time and a Steam library full of sale games (80% under $10).

**v2.0.0** – complete rewrite. Modular Python core, health detection, smart rate limiting, 3 new columns, live
leaderboard with trends. Still broke, still unemployed, but the code is actually organized now.

**Powered ~70% by AI** (Grok for v1, Claude for v2) – fetching data, fixing bugs, writing code/docs while I
procrastinate.

**Wallet safe (for now). Play at your own risk.**

### Quick Links

| What          | Where                                                                          |
|---------------|--------------------------------------------------------------------------------|
| 📋 All Games  | [Full list](games/all-games.md) (sorted by reviews, best first)                |
| 🏷️ By Genre  | [games/](games/) – separate files (FPS, RPG, MOBA, etc.)                       |
| 🏆 Top Online | [top-online.md](games/top-online.md) – live player counts, trends, tier badges |
| 📖 Index      | [games/README.md](games/README.md) – full index with genre breakdown           |

### What's New in v2.0.0

<details>
<summary><b>Architecture overhaul</b> – click to expand</summary>

Complete rewrite of the backend. Old monolithic scripts → modular `scripts/core/` package:

```
scripts/
├── core/
│   ├── constants.py        # Config, rate limits, enums
│   ├── steam_client.py     # HTTP client with backoff + retry
│   ├── data_store.py       # JSONL I/O, validation, dedup
│   ├── fetcher.py          # Batch processor, smart skip
│   └── health_checker.py   # Game status detection
├── ingest_new.py           # Add new games (with health check)
├── update_data.py          # Full data refresh
├── update_reviews.py       # Reviews-only update
├── check_dead_links.py     # 404/410 detection
├── purge_unhealthy.py      # Remove dead/delisted/not-free
├── top_online.py           # Live leaderboard
├── generate_tables.py      # Markdown table generator
└── export_data.py          # CSV export
```

</details>

<details>
<summary><b>Health detection</b> – auto-cleans dead games</summary>

Games are automatically checked and removed if they are:

- 💀 **Delisted** (404/410 on Steam store)
- 🚫 **Unavailable** (Steam API returns `success: false`)
- 💰 **No longer free** (price changed from free to paid)
- ❌ **Invalid link** (unparseable URL)

Removed games are logged to `scripts/removed_games.jsonl` with reason and timestamp.
New game submissions are health-checked **before** being added – dead/paid links are rejected immediately.

</details>

<details>
<summary><b>New columns</b></summary>

| Column     | Source                | Description                           |
|------------|-----------------------|---------------------------------------|
| Metacritic | Steam API             | Metacritic score (when available)     |
| DRM        | Steam categories      | DRM/3rd-party account requirements    |
| Peak Today | Player count tracking | Highest concurrent players seen today |
| Status     | Health checker        | ✅ Active / 💀 Delisted / 💰 Not free  |

</details>

<details>
<summary><b>Top Online leaderboard</b> – upgraded</summary>

- 📈📉 Trend arrows with percentage change
- 🔥⭐🟢🟡🟠🔴💀 Tier badges by population
- ★★★★★ Star rating from reviews
- Summary stats: total players, tier distribution, top genres, anti-cheat breakdown
- Genre + anti-cheat index at the top

</details>

<details>
<summary><b>Rate limiting & anti-ban</b></summary>

- Store API: 1.2-2s delay, 50 games/batch, 15-30s inter-batch pause
- Web API (key): 0.3-0.8s delay
- Exponential backoff + jitter on 429/5xx
- Respects `Retry-After` headers
- Connection pooling via `requests.Session`

</details>

### Automated Workflows

| Workflow          | Schedule                  | What it does                                    |
|-------------------|---------------------------|-------------------------------------------------|
| Auto Update JSON  | Daily 00:00 UTC           | Full data refresh (details + reviews + players) |
| Generate Tables   | After JSON update         | Regenerate all markdown tables                  |
| Export CSV        | Daily 02:00 UTC           | Export data.jsonl → data.csv                    |
| Top Online        | Sun/Wed/Fri 03:00 UTC     | Live player count leaderboard                   |
| Update Reviews    | Every 2 days 06:00 UTC    | Reviews-only refresh                            |
| Check Dead Links  | Every 5 days 04:00 UTC    | HEAD-request 404/410 scanner                    |
| Purge Unhealthy   | Weekly Mon 05:00 UTC      | Full health scan + removal                      |
| Ingest New        | On `temp_info.jsonl` push | Add new games with health check                 |
| Ingest from Issue | On `[add-game]` issue     | Parse issue → ingest → auto-close               |

### Contribute

**Easy way (recommended):**

1. Open an [Issue](../../issues/new) with title starting with `[add-game]` and a Steam link in the body.
2. Workflow auto-picks it up, fetches data, adds to tracker, closes the issue.

**Manual way:**

1. Fork & add entries to `scripts/temp_info.jsonl`:
   ```jsonl
   {"link": "https://store.steampowered.com/app/730/", "type_game": "online", "safe": "y", "notes": "CS2 babyyy"}
   {"link": "570"}
   ```
   Accepts: full URL, short URL, or bare appid. Optional fields: `type_game`, `genre`, `anti_cheat`, `safe`, `notes`.
2. Push – ingest pipeline auto-triggers: validates → dedup check → health check → fetch from Steam → add to
   `data.jsonl` → regenerate tables → clear temp file.
3. Open PR for big changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) | [Issue Templates](.github/ISSUE_TEMPLATE) for bug/feature reports.

### Why This Exists

Unemployed, introvert max level, dropped out uni year 3, mooching off family. Needed a clean F2P list without digging
Steam every time "hôm nay chơi free cái gì đây". So this repo was born – hobby project of a "barely competent" dev
bumped by AI.

v1 was spaghetti code that somehow worked. v2 is... organized spaghetti? At least it has modules now.

> [!WARNING]
> **Disclaimer:** Quality? Fun? Safety? Who knows. I only vouch for games I've played (Safe column: y = yes, ? =
> dunno, ! = careful, n = nope). Problems? Talk to Valve/devs, not me.

### Docs

- [CHANGELOG](CHANGELOG.md) – what changed and when
- [DISCLAIMER](DISCLAIMER.md) – I'm not responsible for anything :))
- [PRIVACY POLICY](docs/PRIVACY_POLICY.md) – Zero data collected.
- [EULA](docs/EULA.md) - You read if you want to use this.
- [Terms of Use](docs/ToS.md)
- [SECURITY](SECURITY.md) - Security.
- [ACKNOWLEDGEMENTS](docs/ACKNOWLEDGEMENTS.md) - My thanks for reason for this repo.
- [Contact](docs/CONTACT.md) - You want Contact me? Check this? :)
- [CODE OF CONDUCT](CODE_OF_CONDUCT.md) – Be chill, no toxicity.

Licensed under [MIT](LICENSE) – do whatever (just keep the credit if you fork).

Made with boredom, instant noodles, and AI. Star if you find a hidden gem ✨

Want to support this broke dev? Check [FUNDING.yml](.github/FUNDING.yml) – buy me a coffee (or Steam sale gift card) to
keep the noob alive :))

Last auto-update: use GitHub Actions. Manual run anytime.