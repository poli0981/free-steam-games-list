[![Games Count](https://img.shields.io/badge/Games-300%2B-green?style=flat&logo=steam)](games/all-games.md)
[![Last Updated](https://img.shields.io/badge/Updated-Daily-blue?style=flat&logo=github-actions)](.github/workflows)
[![Top Online](https://img.shields.io/badge/Top%20Online-Live%20Leaderboard-red?style=flat&logo=steam)](games/top-online.md)
[![Version](https://img.shields.io/badge/version-2.1.0-purple?style=flat&logo=github)](https://github.com/poli0981/free-steam-games-list)
[![Health Check](https://img.shields.io/badge/Health%20Check-Weekly-orange?style=flat&logo=github-actions)](.github/workflows/purge-unhealthy.yml)
![Visitors](https://visitor-badge.laobi.icu/badge?page_id=poli0981.free-steam-games-list)
[![Sponsor](https://img.shields.io/badge/Sponsor-Buy%20me%20a%20coffee-ff5f5f?style=flat&logo=buy-me-a-coffee)](.github/FUNDING.yml)

A **curated list** of free-to-play games on Steam – no quality guarantees, no endorsements, just pure listings by a
broke, unemployed Vietnamese dev with too much free time and a Steam library full of sale games (80% under $10).

**v2.1.0** – extension-compatible schema, HTML scraping for accurate language/DLC data, performance optimized.
Now tracks publisher, platforms, languages (with audio/subtitle breakdown), user tags, and kernel-level anti-cheat
detection. 1,579 lines of Python, zero `jsonlines` dependency, no double-fetch.

**Powered ~70% by AI** (Grok for v1, Claude for v2) – fetching data, fixing bugs, writing code/docs while I
procrastinate.

**Wallet safe (for now). Play at your own risk.**

### Quick Links

| What          | Where                                                                    |
|---------------|--------------------------------------------------------------------------|
| 📋 All Games  | [Full list](games/all-games.md) (sorted by reviews, best first)          |
| 🏷️ By Genre  | [games/](games/) – separate files per genre                              |
| 🏆 Top Online | [top-online.md](games/top-online.md) – live players, trends, tier badges |
| 📖 Index      | [games/README.md](games/README.md) – genre breakdown + file links        |

### What's New in v2.1.0

<details>
<summary><b>Extension-compatible schema</b> – 7 new fields</summary>

Every game record now includes data matching the companion Chrome extension output:

| Field              | Type       | Example                                                  |
|--------------------|------------|----------------------------------------------------------|
| `publisher`        | list       | `["Square Enix", "Feral Interactive"]`                   |
| `platforms`        | list       | `["Windows", "macOS", "Linux"]`                          |
| `languages`        | list       | `["English", "French", "Japanese"]`                      |
| `language_details` | list[dict] | `[{name, interface, audio, subtitles}]`                  |
| `tags`             | list       | `["Story Rich", "Choices Matter", "Female Protagonist"]` |
| `anti_cheat_note`  | str        | `"NetEase Game Security [Non-Kernel]"`                   |
| `is_kernel_ac`     | bool/null  | `true` = kernel 🔴, `false` = non-kernel 🟢              |

Extension pushes rich data → backend merges intelligently → API enriches missing fields only.

</details>

<details>
<summary><b>HTML scraper</b> – accurate languages, DLC, tags</summary>

New `scraper.py` module parses the Steam store page HTML for data the API gets wrong or doesn't provide:

- **Languages**: Store page has a table with Interface ✔ / Full Audio ✔ / Subtitles ✔ per language. API only gives a
  mangled HTML string that was producing broken output like `"Brazillanguages with full audio"`.
- **DLC pricing**: Checks actual `data-price-final` attribute per DLC row. Games with free-only DLC (soundtracks, etc.)
  are no longer falsely flagged as `has_paid_dlc: true`.
- **Tags**: All user-defined tags including hidden overflow ones. API `appdetails` doesn't return these at all.

All three extracted from **one GET request** per game.

</details>

<details>
<summary><b>Performance</b> – faster, leaner, no double-fetch</summary>

- **No double-fetch**: Health check caches API response → ingest reuses it → 1 fewer request per game.
- **Dropped jsonlines**: Pure `json` stdlib I/O. ~20-30% faster for large files.
- **Pre-compiled regex**: 8 scraper patterns compiled once at import, not per-game.
- **1,579 lines total** (down from ~1,900 in v2.0). 18 Python files, 6 core modules.

</details>

<details>
<summary><b>Architecture</b></summary>

```
scripts/
├── core/
│   ├── constants.py        # Config, rate limits, anti-cheat patterns
│   ├── steam_client.py     # HTTP client, backoff, retry, session pooling
│   ├── data_store.py       # JSONL I/O, validation, dedup, schema merge
│   ├── fetcher.py          # Batch processor, apply_details/reviews/players/scraped
│   ├── scraper.py          # Store page HTML parser (languages, DLC, tags)
│   └── health_checker.py   # Game status detection with cached API data
├── ingest_new.py           # Add new games (health check + extension merge)
├── update_data.py          # Daily full refresh
├── update_reviews.py       # Reviews-only (every 2 days)
├── check_dead_links.py     # HEAD-request 404/410 scanner
├── purge_unhealthy.py      # Remove delisted/not-free/invalid
├── top_online.py           # Live leaderboard with trends
├── generate_tables.py      # Markdown tables + genre files + index
├── refetch_all.py          # Force re-fetch ALL (manual only)
├── migrate_schema.py       # Upgrade old records to v2.1
├── export_data.py          # CSV export
└── delete_game.py          # Interactive delete
```

</details>

### Automated Workflows

| Workflow          | Schedule                  | What it does                          |
|-------------------|---------------------------|---------------------------------------|
| Auto Update JSON  | Daily 00:00 UTC           | Full data refresh (API + HTML scrape) |
| Generate Tables   | After JSON update         | Regenerate all markdown tables        |
| Export CSV        | Daily 02:00 UTC           | data.jsonl → data.csv                 |
| Top Online        | Sun/Wed/Fri 03:00 UTC     | Live player leaderboard               |
| Update Reviews    | Every 2 days 06:00 UTC    | Reviews-only refresh                  |
| Check Dead Links  | Every 5 days 04:00 UTC    | HEAD-request 404/410 scanner          |
| Purge Unhealthy   | Weekly Mon 05:00 UTC      | Full health scan + removal            |
| Ingest New        | On `temp_info.jsonl` push | Add new games with health check       |
| Ingest from Issue | On `[add-game]` issue     | Parse issue → ingest → auto-close     |
| Force Re-fetch    | Manual only               | Re-fetch ALL games into v2.1 schema   |
| Migrate Schema    | Manual only               | Upgrade old records                   |

### Contribute

**Easy way (recommended):**

1. Open an [Issue](../../issues/new) with title starting with `[add-game]` and a Steam link in the body.
2. Workflow auto-picks it up, health-checks, fetches data, adds to tracker, closes the issue.

**With the Chrome extension:**

1. Browse Steam store → extension detects F2P games → click "Add to Queue" → push to repo.
2. Extension provides rich data (developer, publisher, platforms, languages, tags, anti-cheat) automatically.

**Manual way:**

1. Fork & add entries to `scripts/temp_info.jsonl`:
   ```jsonl
   {"link": "730", "type_game": "online", "safe": "y", "notes": "CS2 babyyy"}
   {"link": "https://store.steampowered.com/app/570/", "genre": "MOBA"}
   ```
   Accepts: full URL, short URL, or bare appid. Optional: `type_game`, `genre`, `anti_cheat`, `safe`, `notes`.
2. Push → auto ingest: validate → dedup → health check → fetch + scrape → add → regenerate tables.

See [CONTRIBUTING.md](CONTRIBUTING.md) | [Issue Templates](.github/ISSUE_TEMPLATE).

### Why This Exists

Unemployed, introvert max level, dropped out uni year 3, mooching off family. Needed a clean F2P list without digging
Steam every time "hôm nay chơi free cái gì đây". So this repo was born – hobby project of a "barely competent" dev
bumped by AI.

v1 was spaghetti. v2.0 was organized spaghetti. v2.1 is... spaghetti with proper seasoning? It has a scraper now.

> [!WARNING]
> **Disclaimer:** Quality? Fun? Safety? Who knows. I only vouch for games I've played (Safe column: y = yes, ? =
> dunno, ! = careful, n = nope). Problems? Talk to Valve/devs, not me.

### Docs

- [CHANGELOG](CHANGELOG.md) – what changed and when
- [DISCLAIMER](DISCLAIMER.md) – I'm not responsible for anything :))
- [PRIVACY POLICY](docs/PRIVACY_POLICY.md) – Zero data collected.
- [EULA](docs/EULA.md) - You read if you want to use this.
- [Terms of Use](docs/ToS.md)
- [SECURITY](SECURITY.md) - Security???
- [ACKNOWLEDGEMENTS](docs/ACKNOWLEDGEMENTS.md) - My thanks for reason for this repo.
- [Contact](docs/CONTACT.md) - You want Contact me? Check this? :)
- [CODE OF CONDUCT](CODE_OF_CONDUCT.md) – Be chill, no toxicity.

Licensed under [MIT](LICENSE) – do whatever (just keep the credit if you fork).

Made with boredom, instant noodles, and AI. Star if you find a hidden gem ✨

Want to support this broke dev? Check [FUNDING.yml](.github/FUNDING.yml) – buy me a coffee (or Steam sale gift card) to
keep the noob alive :))

Last auto-update: Daily via GitHub Actions. Manual run anytime.