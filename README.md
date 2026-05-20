[![Games Count](https://img.shields.io/badge/Games-1.2k%2B-green?style=flat&logo=steam)](games/all-games_part1.md)
[![Last Updated](https://img.shields.io/badge/Updated-Daily-blue?style=flat&logo=github-actions)](.github/workflows)
[![Top Online](https://img.shields.io/badge/Top%20Online-Live%20Leaderboard-red?style=flat&logo=steam)](games/top-online.md)
[![Version](https://img.shields.io/badge/version-3.2.5-purple?style=flat&logo=github)](https://github.com/poli0981/free-steam-games-list)
[![Web App](https://img.shields.io/badge/Web%20App-Live-2563eb?style=flat&logo=react)](https://poli0981.github.io/free-steam-games-list/)
[![Desktop](https://img.shields.io/badge/Desktop-Tauri%202-FFC131?style=flat&logo=tauri)](https://github.com/poli0981/free-steam-games-list/releases)
[![Health Check](https://img.shields.io/badge/Health%20Check-Weekly-orange?style=flat&logo=github-actions)](.github/workflows/purge-unhealthy.yml)
![Visitors](https://visitor-badge.laobi.icu/badge?page_id=poli0981.free-steam-games-list)
[![Sponsor](https://img.shields.io/badge/Sponsor-Buy%20me%20a%20coffee-ff5f5f?style=flat&logo=buy-me-a-coffee)](.github/FUNDING.yml)

A **curated list** of free-to-play games on Steam — now ~1,200 of them — no quality guarantees, no endorsements, just pure listings by a broke, unemployed Vietnamese dev with too much free time and a Steam library full of sale games (80% under $10).

**v3.0.0** is the version that grew limbs. It is no longer a list. It is also:

- a **React web app** at <https://poli0981.github.io/free-steam-games-list/> with a virtualised 1.2k-row table, 12 charts, fuzzy search, faceted filters, owner-gated bulk edit/delete with **GPG-signed commits**, queue-based add (single + JSON bulk), CSV/JSON export, validation badges, command palette, PWA / offline cache, **vi/en i18n**, and per-game permalinks;
- a **desktop app** (Tauri 2, fixed-size 1400 × 900 window — see Releases for Win/Mac/Linux installers);
- the same **Python pipeline** that has run daily under GitHub Actions since v1.

**Powered ~70 % by AI** (Grok for v1, Claude for v2 + the entire web/desktop layer) — code is reviewed and tested, but mistakes happen. See the [Disclaimer](docs/DISCLAIMER.md) for the specific accuracy caveats (genre best-effort, English-only assumptions, test-data leakage, unsigned-commit dev artefacts).

**Wallet safe (for now). Play at your own risk.**

### Quick links

| Surface              | URL                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 🌐 Web app          | <https://poli0981.github.io/free-steam-games-list/>                                                                  |
| 🖥️ Desktop releases  | [GitHub Releases](https://github.com/poli0981/free-steam-games-list/releases) (Win `.msi`, Mac `.dmg`, Linux `.AppImage`) |
| 📋 All games (md)   | [games/all-games_part1.md](games/all-games_part1.md) (sorted by reviews)                                             |
| 🏆 Top online (md)  | [games/top-online.md](games/top-online.md)                                                                           |
| 🎯 Top offline (md) | [games/top-offline.md](games/top-offline.md)                                                                         |
| 🏷️ By genre         | [games/](games/) — separate file per genre                                                                           |
| 📦 Raw data         | [data/data_001.jsonl](data/data_001.jsonl) + [data/data_002.jsonl](data/data_002.jsonl) (sharded JSONL)              |
| 📖 Index            | [games/README.md](games/README.md)                                                                                   |
| 🛠️ About            | <https://poli0981.github.io/free-steam-games-list/#/about> (in-app)                                                 |
| 👤 Authors          | [`AUTHORS.md`](AUTHORS.md) — maintainer + contact channels + AI-assistant disclosure                                 |
| 🤖 Telegram bot     | [`@my_skull_bot`](https://t.me/my_skull_bot) — Scraper Info Game bot, see [`CONTRIBUTING.md`](CONTRIBUTING.md)        |

### What's new in v3.0.0

<details>
<summary><b>Web app at <code>poli0981.github.io/free-steam-games-list/</code></b></summary>

A React/Vite SPA hosted on GitHub Pages, fetching data live from `raw.githubusercontent.com`. Features:

- **Browse** — virtualised 1.2k-row table (TanStack Table + Virtual), faceted filters (genre, type, platform, status), Fuse.js fuzzy search, sortable columns including correctly-parsed release-date sorting, 50/100/200/500/all pagination, hidden scrollbar.
- **Charts** — 12 charts via Apache ECharts: KPI overview, top-online bar, genre treemap, platform donut, language heatmap, tag word cloud, anti-cheat stacked, release-year histogram, catalog-growth cumulative line, review histogram, online player tiers pie, DRM/DLC bars.
- **Edit / add / delete** (owner-only) — single edit drawer with form / JSON-editor toggle, bulk edit + delete in one signed commit, Steam-link queue (single + JSON bulk) into `scripts/temp_info.jsonl`, diff viewer, conflict-retry, optimistic local cache update so edits show up instantly without waiting for the Fastly CDN.
- **GPG signing** — paste your OpenPGP private key, unlock per-session, every edit commit gets a detached binary signature → GitHub verifies them as ✓. Multi-UID picker, idle auto-lock 5/15/30/60 min.
- **PWA** — installable, offline browse via a Workbox NetworkFirst service worker.
- **i18n** vi / en — Vietnamese + English UI, auto-detected from `navigator.language`, switchable in Settings.
- **Per-game permalinks** `/games/:appid` — share-friendly deep links into the detail drawer.
- **Activity feed** — recent commits with verified badges, filter Me / Bots / All.
- **Health page** — validation badges + workflow_dispatch buttons for the six maintenance pipelines.
- **⌘K command palette** — pages / charts / GPG lock-unlock / fuzzy game search.
- **Owner-gate** — non-owner visitors see read-only browse + charts, no edit affordances.

Site is rebuilt and re-deployed automatically on every commit to `data/**` or `web/**`. See [`web/README.md`](web/README.md) for stack details and the per-phase changelog.

</details>

<details>
<summary><b>Desktop app (Tauri 2)</b></summary>

A native shell around the same web app, distributed via [GitHub Releases](https://github.com/poli0981/free-steam-games-list/releases):

- Windows `.msi`, macOS `.dmg` (universal Apple Silicon + Intel), Linux `.AppImage` and `.deb`.
- Fixed 1400 × 900 window, no maximise, no resize — keeps the layout consistent.
- Dark theme, stays in standalone mode.
- Same data path as the web app (reads `raw.githubusercontent.com` live), same offline cache.

Built by `.github/workflows/release-desktop.yml` (matrix Win/Mac/Linux via `tauri-apps/tauri-action`), triggered by pushing a `desktop-v*` tag or a manual workflow run. Each release auto-attaches its installers as draft assets.

```bash
# from web/, locally:
npm run tauri:dev      # dev build with hot reload
npm run tauri:build    # release binary into web/src-tauri/target/release/bundle
```

</details>

<details>
<summary><b>v2.x foundations still here</b></summary>

The Python pipeline that powered v2 is untouched and runs daily as before:

- Schema v2.2 (23 + manual fields per record), MIT-licensed, sharded data in `data/data_*.jsonl` (cap 800 records/shard, current total ~1,230) plus a `data/index.json` manifest.
- Extension-compatible: the [Chrome extension](https://github.com/poli0981/free-steam-games-list-extension) pushes pre-fetched rich data straight into `scripts/temp_info.jsonl`; the ingest workflow merges and dedupes.
- HTML scraper for accurate language tables, DLC pricing, and user tags — single GET per game.
- Health-checked: dead-link sweep every 5 days, full purge every Monday.
- Reviews-only refresh every 2 days; full refresh daily.

</details>

<details>
<summary><b>Architecture</b></summary>

```
.
├── data/                       # Sharded data (the source of truth)
│   ├── data_001.jsonl          # ≤ 800 records
│   ├── data_002.jsonl          # the rest
│   └── index.json              # last_updated, totals, shard manifest
│
├── games/                      # Auto-generated markdown tables
│   ├── all-games_part*.md      # split into ~200/file
│   ├── top-online.md           # live leaderboard
│   └── {genre}.md              # per-genre files
│
├── scripts/                    # Python data pipeline
│   ├── core/
│   │   ├── constants.py        # rate limits, anti-cheat patterns, schema
│   │   ├── steam_client.py     # rate-limited HTTP client
│   │   ├── data_store.py       # JSONL I/O, dedup, schema merge
│   │   ├── fetcher.py          # batch processor
│   │   ├── scraper.py          # HTML page parser
│   │   └── health_checker.py   # status detection
│   ├── ingest_new.py / update_data.py / generate_tables.py / …
│   └── temp_info.jsonl         # ingest queue
│
├── web/                        # React/Vite/Tauri front-end
│   ├── src/                    # React app: pages, components, charts, i18n
│   ├── src-tauri/              # Tauri 2 desktop wrapper (Rust)
│   ├── public/                 # PWA icons + manifest
│   └── dist/                   # build artefacts (PWA + desktop)
│
├── docs/                       # Legal + acknowledgements + contact
├── .github/workflows/          # 11 workflows: data pipeline + Pages + desktop release
└── LICENSE                     # MIT
```

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

### Automated workflows

| Workflow              | Trigger                          | What it does                                              |
| --------------------- | -------------------------------- | --------------------------------------------------------- |
| Auto Update JSON      | Daily 00:00 UTC                  | Full data refresh (API + HTML scrape)                     |
| Generate Tables       | After JSON update                | Regenerate all markdown tables                            |
| Top Online            | Sun/Wed/Fri 03:00 UTC            | Live player leaderboard                                   |
| Update Reviews        | Every 2 days 06:00 UTC           | Reviews-only refresh                                      |
| Check Dead Links      | Every 5 days 04:00 UTC           | HEAD-request 404/410 scanner                              |
| Purge Unhealthy       | Weekly Mon 05:00 UTC             | Full health scan + removal                                |
| Ingest New            | On `scripts/temp_info.jsonl` push | Add new games (web app + extension queue here)           |
| Ingest from Issue     | On `[add-game]` issue            | Parse issue → ingest → auto-close                         |
| Force Re-fetch        | Manual only                      | Re-fetch ALL games                                        |
| **Mark Dead Games**   | Mon + Thu 04:30 UTC              | Online + >1y + 0 players ≥14d → `is_dead=true` + 💀 note |
| **Bot Ingest**        | Telegram bot dispatch            | Add games via `@my_skull_bot` (whitelist required)        |
| **Deploy Web**        | On `web/**` or `data/**` change  | Build + deploy SPA to GitHub Pages                        |
| **Release Desktop**   | On `desktop-v*` tag              | Matrix-build Tauri installers (Win/Mac/Linux) → Releases |
| **Top Offline**       | 1st + 15th of month 05:00 UTC    | Bi-weekly leaderboard for single-player F2P concurrents   |
| **Announce Discussion** | On release `published`         | Auto-create a GitHub Discussion in `Announcements` per release |

### Contribute

**The easy way — open an issue.** Pick the [Add games](.github/ISSUE_TEMPLATE/add_games.yml) template and paste up to 15 Steam links. Workflow auto-ingests, validates, health-checks, fetches metadata, and closes the issue with a status comment. The [Bug report](.github/ISSUE_TEMPLATE/bug_report.yml), [Feature request](.github/ISSUE_TEMPLATE/feature_request.yml), [Delete game](.github/ISSUE_TEMPLATE/delete_game.yml), and [Feedback](.github/ISSUE_TEMPLATE/feedback.yml) templates are also pre-filled.

**The web app way — sign in.** If you have repo write access, sign into the web app with a Classic GitHub PAT (scopes: `repo` + `workflow`) and use the Add or Edit drawers. Optionally unlock a GPG key in Settings to get **Verified ✓** commits.

**The Telegram bot way — `@my_skull_bot`.** No GitHub PAT needed. One-time: DM the maintainer privately with your Telegram `user_id` (NEVER post it in public Discord / Telegram groups / GitHub issues — see [`CONTRIBUTING.md`](CONTRIBUTING.md)) → maintainer adds you to the whitelist → chat with the bot when it's online (~2–5 hrs/day, runs in Docker locally) and follow its prompts. QR codes for the bot and DM live at [`assets/qr/`](assets/qr/).

**The extension way.** The companion Chrome extension detects F2P games on Steam store pages and pushes pre-fetched metadata to `scripts/temp_info.jsonl`.

**The manual way.** Fork, append to `scripts/temp_info.jsonl`, and push:

```jsonl
{"link": "730", "type_game": "online", "safe": "y", "notes": "CS2 babyyy"}
{"link": "https://store.steampowered.com/app/570/", "genre": "MOBA"}
```

Accepts a full URL, short URL, or bare appid. Optional manual fields: `type_game`, `genre`, `anti_cheat`, `anti_cheat_note`, `is_kernel_ac`, `safe`, `notes`. The ingest pipeline preserves these on top of whatever it fetches from Steam.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full flow.

### Why this exists

Unemployed, introvert max level, dropped out uni year 3, mooching off family. Needed a clean F2P list without digging Steam every time "hôm nay chơi free cái gì đây". So this repo was born — hobby project of a "barely competent" dev pumped by AI.

- v1 was spaghetti.
- v2.0 was organised spaghetti.
- v2.1 was spaghetti with proper seasoning. It got a scraper.
- **v3.0 is spaghetti with a website on top, a desktop app, and bilingual menus.** Still spaghetti underneath. Still a hobby.

> [!WARNING]
> **Disclaimer.** Quality / fun / safety: who knows. The maintainer only vouches for games personally played (`safe` column: `y` = yes, `?` = dunno, `n` = nope). Problems with a game are between you, Valve, and the developer of that game — not the maintainer. See [`docs/DISCLAIMER.md`](docs/DISCLAIMER.md) for the specific accuracy caveats.

### Docs

- [AUTHORS](AUTHORS.md) — maintainer + canonical handle map + AI-assistant disclosure.
- [CHANGELOG](CHANGELOG.md) — what changed in each version.
- [CONTRIBUTING](CONTRIBUTING.md) — issue templates, web-app sign-in, Telegram bot flow, extension, manual fork.
- [PC spec](docs/pc_spec.md) ([VI](docs/i18n/vi/pc_spec.md)) — maintainer's dev hardware + test devices.
- [Dev environment](docs/dev_env.md) ([VI](docs/i18n/vi/dev_env.md)) — IDE, toolchains (Python 3.12 / Node ≥ 22 / Rust stable / Tauri 2), workflow.
- [Tauri build](web/src-tauri/TAURI.md) — desktop build prerequisites + signing + auto-update.
- [Telegram bot](docs/telegram-bot.md) — pointer to the external bot user guide + how it integrates with this repo.
- [DISCLAIMER](docs/DISCLAIMER.md) — accuracy caveats, no-warranty, the broke-maintainer note.
- [Terms of Use](docs/ToS.md) — usage agreement, contributions, governing law, **rules for sharing your Telegram `user_id`**.
- [EULA](docs/EULA.md) — supplemental to the MIT licence.
- [Privacy Policy](docs/PRIVACY_POLICY.md) — zero personal data collected by the site; **Telegram-bot data flow** documented separately.
- [Acknowledgements](docs/ACKNOWLEDGEMENTs.md) — credits, AI assistants, third-party libraries.
- [Contact](docs/Contact.md) — where to find the maintainer.
- [CODE OF CONDUCT](CODE_OF_CONDUCT.md) — be chill.
- [SECURITY](SECURITY.md) — vulnerability reporting.
- [`web/README.md`](web/README.md) — stack details, per-phase changelog, build instructions.

Licensed under [MIT](LICENSE) — do whatever; keep the credit if you fork. Star if you find a hidden gem ✨

Last auto-update: daily via GitHub Actions. Manual runs from the [Actions tab](../../actions) or the web app's Health page.