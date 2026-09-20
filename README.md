[![Games Count](https://img.shields.io/badge/Games-3.6k%2B-green?style=flat&logo=steam)](data/)
[![Last Updated](https://img.shields.io/badge/Updated-Daily-blue?style=flat&logo=github-actions)](.github/workflows)
[![Top Online](https://img.shields.io/badge/Top%20Online-Live%20Leaderboard-red?style=flat&logo=steam)](games/top-online.md)
[![Version](https://img.shields.io/badge/version-4.0.0-purple?style=flat&logo=github)](https://github.com/poli0981/free-steam-games-list)
[![Web App](https://img.shields.io/badge/Web%20App-Live-2563eb?style=flat&logo=svelte)](https://free-steam-games.win/)
[![Desktop](https://img.shields.io/badge/Desktop-Tauri%202-FFC131?style=flat&logo=tauri)](https://github.com/poli0981/free-steam-games-list/releases)
[![Android](https://img.shields.io/badge/Android-11%2B%20APK-3DDC84?style=flat&logo=android)](https://github.com/poli0981/free-steam-games-list/releases)
[![Health Check](https://img.shields.io/badge/Health%20Check-Weekly-orange?style=flat&logo=github-actions)](.github/workflows/purge-unhealthy.yml)
![Visitors](https://visitor-badge.laobi.icu/badge?page_id=poli0981.free-steam-games-list)
[![Sponsor](https://img.shields.io/badge/Sponsor-Buy%20me%20a%20coffee-ff5f5f?style=flat&logo=buy-me-a-coffee)](.github/FUNDING.yml)

A **curated list** of free-to-play games on Steam — now ~3,600 of them — no quality guarantees, no endorsements, just pure listings by a broke, unemployed Vietnamese dev with too much free time and a Steam library full of sale games (80% under $10).

**v4.0.0** is the version that got rebuilt from the ground up. It is still a list. It is also:

- a **web app** at <https://free-steam-games.win/> (SvelteKit, served by a Cloudflare Worker) with a virtualised table of every game, charts, fuzzy search, filters you can link to, CSV/JSON export, a command palette, a page per game that search engines can read, **en/vi i18n**, and an installable offline mode. It is read-only for visitors: there is no sign-in;
- a **desktop app** (Tauri 2, resizable window, updates itself from GitHub Releases — Win/Mac/Linux installers);
- an **Android app** (sideloaded APK, Android 11+);
- a **review queue** at `/admin`, behind Cloudflare Access, where games found by the daily discovery sweep wait for a human to approve them;
- the same **Python pipeline** that has run daily under GitHub Actions since v1.

**Powered ~70 % by AI** (Grok for v1, Claude for v2 + the entire web/desktop layer) — code is reviewed and tested, but mistakes happen. See the [Disclaimer](docs/DISCLAIMER.md) for the specific accuracy caveats (genre best-effort, English-only assumptions, test-data leakage, unsigned-commit dev artefacts).

**Wallet safe (for now). Play at your own risk.**

### Quick links

| Surface              | URL                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 🌐 Web app          | <https://free-steam-games.win/>                                                                  |
| 🖥️ Desktop releases  | [GitHub Releases](https://github.com/poli0981/free-steam-games-list/releases) (Win `.msi`, Mac `.dmg`, Linux `.AppImage`) |
| 📱 Android APK      | [GitHub Releases](https://github.com/poli0981/free-steam-games-list/releases) (sideload `.apk`, **Android 11+** — see [`docs/android-support.md`](docs/android-support.md)) |
| 🏆 Top online (md)  | [games/top-online.md](games/top-online.md)                                                                           |
| 🎯 Top offline (md) | [games/top-offline.md](games/top-offline.md)                                                                         |
| 📦 Raw data         | [data/data_001.jsonl](data/data_001.jsonl) … `data_005.jsonl` (5 sharded JSONL files)              |
| 🛠️ About            | <https://free-steam-games.win/about> (in-app)                                                   |
| 👤 Authors          | [`AUTHORS.md`](AUTHORS.md) — maintainer + contact channels + AI-assistant disclosure                                 |

### What's new in v4.0.0

<details>
<summary><b>Web app at <code>free-steam-games.win/</code></b></summary>

A SvelteKit 2 / Svelte 5 app, prerendered and served by a Cloudflare Worker that also proxies the dataset (`/api/data/*`) and Steam artwork (`/img/*`), so your browser talks to this site only. Features:

- **Browse** — virtualised table (TanStack Virtual), filters for genre, type, platform, status, anti-cheat and safety, Fuse.js fuzzy search, sortable columns, 50/100/200/500/all pages. Filters live in the URL, so a filtered view can be shared.
- **Charts** — Apache ECharts: dashboard KPIs, genres, platforms, languages, tags, anti-cheat (chart and a searchable index), reviews, player tiers, release years and catalogue growth, DRM/DLC, delisted games, plus a stats page (Metacritic, retention, games that went quiet).
- **A page per game** — `/games/:appid` is prerendered for search engines and filled with live player counts and reviews in the browser.
- **Fresh data, verified** — `data/index.json` carries a SHA-256 per shard; the app only caches a generation it could verify, keeps the last good one offline, and re-checks when you come back to the tab.
- **Installable** — a web app you can install, with an offline mode and an update prompt.
- **i18n** vi / en — auto-detected, switchable from the welcome page or Settings.
- **⌘K command palette**, **first-run introduction**, and the legal documents rendered in the app.

Pushing to `main` deploys (Cloudflare Workers Builds). Pipeline commits to `data/**` do not need a rebuild: the data is proxied, not bundled. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

</details>

<details>
<summary><b>Desktop and Android apps (Tauri 2)</b></summary>

A native shell around the same web app, distributed via [GitHub Releases](https://github.com/poli0981/free-steam-games-list/releases):

- Windows `.msi`, macOS `.dmg` (universal Apple Silicon + Intel), Linux `.AppImage` and `.deb`, and an Android `.apk`.
- Resizable window; `steam://` links open the Steam client.
- The desktop app checks for a signed update on start and installs it when you say so, keeping your settings.
- Same data path as the web app (`/api/data/*` on free-steam-games.win), same offline cache.

Built by `.github/workflows/release-desktop.yml` (matrix Win/Mac/Linux via `tauri-apps/tauri-action`) and `release-android.yml`, triggered by a `desktop-v*` / `android-v*` tag or a manual run. Each release is created as a draft.

```bash
# from web/, locally:
npm run tauri:dev      # dev build with hot reload
npm run tauri:build    # release binary into web/src-tauri/target/release/bundle
```

</details>

<details>
<summary><b>The review queue at <code>/admin</code></b></summary>

`Discover New Games` sweeps the Steam store daily and proposes candidates into a Cloudflare D1 queue. The maintainer reviews them in a small Svelte app embedded in the Worker (never shipped to visitors): approving commits the store link to `scripts/temp_info.jsonl`, and the pipeline does the rest. Decided and already-published rows are read-only. Corrections to published games are saved as override files that survive every pipeline run. See [`docs/ADMIN.md`](docs/ADMIN.md).

</details>

<details>
<summary><b>v2.x foundations still here</b></summary>

The Python pipeline that powered v2 is untouched and runs daily as before:

- Schema v2.2 (23 + manual fields per record), CC BY 4.0 (see [LICENSE-DATA](LICENSE-DATA)), sharded data in `data/data_*.jsonl` (cap 800 records/shard) plus a `data/index.json` manifest with a SHA-256 per shard.
- Extension-compatible: the [Chrome extension](https://github.com/poli0981/steam-f2p-extension) pushes pre-fetched rich data straight into `scripts/temp_info.jsonl`; the ingest workflow merges and dedupes.
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
│   ├── data_002.jsonl … 005    # the rest
│   └── index.json              # last_updated, totals, shard manifest
│
├── games/                      # The two generated leaderboards
│   ├── top-online.md           # live leaderboard
│   └── top-offline.md          # most-played offline-capable
│
├── scripts/                    # Python data pipeline
│   ├── core/
│   │   ├── constants.py        # rate limits, anti-cheat patterns, schema
│   │   ├── steam_client.py     # rate-limited HTTP client
│   │   ├── data_store.py       # JSONL I/O, dedup, schema merge
│   │   ├── fetcher.py          # batch processor
│   │   ├── scraper.py          # HTML page parser
│   │   └── health_checker.py   # status detection
│   ├── ingest_new.py / update_data.py / discover_new.py / …
│   └── temp_info.jsonl         # ingest queue
│
├── web/                        # Everything that is not the pipeline
│   ├── src/                    # SvelteKit app: routes, components, charts, i18n
│   ├── admin/                  # /admin review app (embedded in the Worker, never in dist/)
│   ├── worker/                 # Cloudflare Worker: data + image proxy, admin API, D1 migrations
│   ├── shared/                 # rules shared by the Worker and the admin app
│   ├── src-tauri/              # Tauri 2 desktop + Android shell (Rust)
│   └── static/                 # icons, social image, robots.txt, _headers
│
├── docs/                       # Legal + acknowledgements + contact
├── .github/workflows/          # data pipeline, discovery, CI, desktop/Android release
├── LICENSE                     # MIT — code
└── LICENSE-DATA                # CC BY 4.0 — dataset
```

</details>

<details>
<summary><b>Pipeline scripts</b></summary>

```
scripts/
├── core/
│   ├── constants.py        # Config, rate limits, anti-cheat patterns
│   ├── steam_client.py     # HTTP client, backoff, retry, session pooling
│   ├── data_store.py       # JSONL I/O, validation, dedup, save_main() + index.json
│   ├── overrides.py        # Human corrections re-applied on every write
│   ├── fetcher.py          # Batch processor, apply_details/reviews/players/scraped
│   ├── scraper.py          # Store page HTML parser (languages, DLC, tags)
│   └── health_checker.py   # Game status detection with cached API data
├── discover_new.py         # Propose new games into the /admin review queue
├── ingest_new.py           # Add queued games (health check + extension merge)
├── update_data.py          # Daily full refresh
├── update_reviews.py       # Reviews-only (every 2 days)
├── mark_dead_games.py      # Flag online games with no players
├── check_dead_links.py     # HEAD-request 404/410 scanner
├── purge_unhealthy.py      # Remove delisted/not-free/invalid
├── top_online.py / top_offline.py  # Leaderboards
├── edit_game.py            # Overrides from the command line
├── refetch_all.py          # Force re-fetch ALL (manual only)
└── delete_game.py          # Interactive delete
```

</details>

### Automated workflows

| Workflow              | Trigger                          | What it does                                              |
| --------------------- | -------------------------------- | --------------------------------------------------------- |
| Auto Update JSON      | Daily 00:00 UTC                  | Full data refresh (API + HTML scrape)                     |
| Discover New Games    | Daily 05:00 UTC                  | Propose new free games into the `/admin` review queue     |
| Ingest New            | On `scripts/temp_info.jsonl` push | Add approved and extension-submitted games               |
| Top Online            | Sun/Wed/Fri 03:00 UTC            | Live player leaderboard                                   |
| Top Offline           | 1st + 15th of month 05:00 UTC    | Leaderboard for single-player F2P concurrents             |
| Update Reviews        | Every 2 days 06:00 UTC           | Reviews-only refresh                                      |
| Check Dead Links      | Every 5 days 04:00 UTC           | HEAD-request 404/410 scanner                              |
| Purge Unhealthy       | Weekly Mon 05:00 UTC             | Full health scan + removal                                |
| Mark Dead Games       | Mon + Thu 04:30 UTC              | Online + >1y + 0 players ≥14d → `is_dead=true` + 💀 note |
| Daily Snapshot        | Daily 23:00 UTC                  | Per-game players and reviews into `data/snapshots/`       |
| Force Re-fetch        | Manual only                      | Re-fetch ALL games                                        |
| Web CI / Python Tests | On `web/**` / `scripts/**` change | Type check, tests, build and output checks               |
| Release Desktop / Android | On `desktop-v*` / `android-v*` tag | Build the apps into a draft release                  |
| Announce Discussion   | On release `published`           | Auto-create a GitHub Discussion in `Announcements`        |

The site itself is deployed by Cloudflare Workers Builds on every push to `main`, not by a workflow.

### Contribute

**The browser extension.** The companion [Chrome extension](https://github.com/poli0981/steam-f2p-extension) detects
free-to-play games on Steam store pages and pushes pre-fetched metadata straight
to `scripts/temp_info.jsonl`; `Ingest New Game Links` merges and dedupes on push.
This is the only submission route.

Most new games arrive on their own: `Discover New Games` sweeps the Steam store
daily into a review queue, and the maintainer approves them at `/admin`.
Discovery only proposes — publication is always a human decision.

**Issues** are for reports, not submissions:
[Bug report](.github/ISSUE_TEMPLATE/bug_report.yml),
[Feature request](.github/ISSUE_TEMPLATE/feature_request.yml),
[Delete game](.github/ISSUE_TEMPLATE/delete_game.yml) and
[Feedback](.github/ISSUE_TEMPLATE/feedback.yml). All reviewed by hand.

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
- v3.0 was spaghetti with a website on top, a desktop app, and bilingual menus.
- **v4.0 is the same spaghetti, rebuilt, with a review queue so it stops needing to be cooked by hand.** Still a hobby.

> [!WARNING]
> **Disclaimer.** Quality / fun / safety: who knows. The maintainer only vouches for games personally played (`safe` column: `y` = yes, `?` = dunno, `n` = nope). Problems with a game are between you, Valve, and the developer of that game — not the maintainer. See [`docs/DISCLAIMER.md`](docs/DISCLAIMER.md) for the specific accuracy caveats.

### Docs

- [AUTHORS](AUTHORS.md) — maintainer + canonical handle map + AI-assistant disclosure.
- [CHANGELOG](CHANGELOG.md) — what changed in each version.
- [CONTRIBUTING](CONTRIBUTING.md) — issue templates, the browser extension, manual fork.
- [PC spec](docs/pc_spec.md) ([VI](docs/i18n/vi/pc_spec.md)) — maintainer's dev hardware + test devices.
- [Dev environment](docs/dev_env.md) ([VI](docs/i18n/vi/dev_env.md)) — IDE, toolchains (Python 3.12 / Node 24 / Rust stable / Tauri 2), workflow.
- [Tauri build](web/src-tauri/TAURI.md) — desktop build prerequisites + signing + auto-update.
- [DISCLAIMER](docs/DISCLAIMER.md) — accuracy caveats, no-warranty, the broke-maintainer note.
- [Terms of Use](docs/ToS.md) — usage agreement, contributions, governing law.
- [EULA](docs/EULA.md) — plain-language commentary on both licences.
- [Privacy Policy](docs/PRIVACY_POLICY.md) — no accounts, no tracking cookies, no profile; what Cloudflare logs as the host, the one cookieless page-view count, and where the site is not served.
- [Deployment](docs/DEPLOYMENT.md) — how a push becomes a deploy, and how to verify or roll one back.
- [Admin setup](docs/ADMIN.md) — Cloudflare Access and the GitHub App behind `/admin`.
- [Acknowledgements](docs/ACKNOWLEDGEMENTs.md) — credits, AI assistants, third-party libraries.
- [Third-party dev tooling](docs/THIRD_PARTY.md) — dead-code / lint / audit tools + the pre-publish check suite.
- [Contact](docs/Contact.md) — where to find the maintainer.
- [CODE OF CONDUCT](CODE_OF_CONDUCT.md) — be chill.
- [SECURITY](SECURITY.md) — vulnerability reporting.
- [`web/README.md`](web/README.md) — stack details, per-phase changelog, build instructions.

Code is [MIT](LICENSE); the dataset is [CC BY 4.0](LICENSE-DATA) with carve-outs for fields the project does not own (`description`, `header_image`). Keep the right licence with you if you fork. Star if you find a hidden gem ✨

Last auto-update: daily via GitHub Actions. Manual runs from the [Actions tab](../../actions).