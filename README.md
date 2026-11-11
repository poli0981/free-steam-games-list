[![Status](https://img.shields.io/badge/status-stable%20%C2%B7%20maintenance%20only-2ea44f?style=flat)](#project-status)
[![Games Count](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fpoli0981%2Ffree-steam-games-list%2Fmain%2Fdata%2Findex.json&query=%24.total&label=Games&color=green&style=flat&logo=steam)](data/)
[![Last Updated](https://img.shields.io/badge/Updated-Daily-blue?style=flat&logo=github-actions)](.github/workflows)
[![Top Online](https://img.shields.io/badge/Top%20Online-Live%20Leaderboard-red?style=flat&logo=steam)](games/top-online.md)
[![Health Check](https://img.shields.io/badge/Health%20Check-Daily-orange?style=flat&logo=github-actions)](.github/workflows/purge-unhealthy.yml)

[![Version](https://img.shields.io/github/v/release/poli0981/free-steam-games-list?filter=v*&sort=semver&label=dataset&color=purple&style=flat&logo=github)](https://github.com/poli0981/free-steam-games-list/releases)
[![Desktop](https://img.shields.io/github/v/release/poli0981/free-steam-games-list?filter=desktop-v*&label=desktop&color=FFC131&style=flat&logo=tauri)](https://github.com/poli0981/free-steam-games-list/releases)
[![Android](https://img.shields.io/github/v/release/poli0981/free-steam-games-list?filter=android-v*&label=android%2011%2B&color=3DDC84&style=flat&logo=android)](https://github.com/poli0981/free-steam-games-list/releases)
[![Web App](https://img.shields.io/website?url=https%3A%2F%2Ffree-steam-games.win%2F&label=web%20app&style=flat&logo=svelte)](https://free-steam-games.win/)

[![Web CI](https://github.com/poli0981/free-steam-games-list/actions/workflows/web-ci.yml/badge.svg?branch=main)](https://github.com/poli0981/free-steam-games-list/actions/workflows/web-ci.yml)
[![Python Tests](https://github.com/poli0981/free-steam-games-list/actions/workflows/python-tests.yml/badge.svg?branch=main)](https://github.com/poli0981/free-steam-games-list/actions/workflows/python-tests.yml)
[![CodeQL](https://github.com/poli0981/free-steam-games-list/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/poli0981/free-steam-games-list/actions/workflows/codeql.yml)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=poli0981_free-steam-games-list&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=poli0981_free-steam-games-list)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=poli0981_free-steam-games-list&metric=coverage)](https://sonarcloud.io/summary/new_code?id=poli0981_free-steam-games-list)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-025E8C?style=flat&logo=dependabot)](.github/dependabot.yml)

[![Code: MIT](https://img.shields.io/badge/code-MIT-yellow?style=flat)](LICENSE)
[![Data: CC BY 4.0](https://img.shields.io/badge/data-CC%20BY%204.0-lightgrey?style=flat&logo=creativecommons)](LICENSE-DATA)
[![Node 26](https://img.shields.io/badge/Node-26-5FA04E?style=flat&logo=nodedotjs)](web/.node-version)
[![Python 3.15](https://img.shields.io/badge/Python-3.15-3776AB?style=flat&logo=python)](requirements.txt)
[![SvelteKit 3](https://img.shields.io/badge/SvelteKit-3-FF3E00?style=flat&logo=svelte)](web/README.md)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8D8?style=flat&logo=tauri)](web/src-tauri/TAURI.md)
![Visitors](https://visitor-badge.laobi.icu/badge?page_id=poli0981.free-steam-games-list)
[![Sponsor](https://img.shields.io/badge/Sponsor-Buy%20me%20a%20coffee-ff5f5f?style=flat&logo=buy-me-a-coffee)](.github/FUNDING.yml)

A **curated list** of free-to-play games on Steam — the badge above has today's count — no quality guarantees, no endorsements, just pure listings by a broke, unemployed Vietnamese dev with too much free time and a Steam library full of sale games (80% under $10).

**v4.0.0** is the version that got rebuilt from the ground up. It is still a list. It is also:

- a **web app** at <https://free-steam-games.win/> (SvelteKit, served by a Cloudflare Worker) with a virtualised table of every game, charts, fuzzy search, filters you can link to, CSV/JSON export, a command palette, a page per game that search engines can read, **en/vi i18n**, and an installable offline mode. It is read-only for visitors: there is no sign-in;
- a **desktop app** (Tauri 2, resizable window, updates itself from GitHub Releases — Win/Mac/Linux installers);
- an **Android app** (sideloaded APK, Android 11+);
- an **admin** at `/admin`, behind Cloudflare Access: a review queue for the games the daily discovery sweep finds (approved by the maintainer, or in capped daily batches by a rule the maintainer turns on), corrections to published games, and removals;
- the same **Python pipeline** that has run daily under GitHub Actions since v1.

**Powered ~70 % by AI** (Grok for v1, Claude for v2 + the entire web/desktop layer) — code is reviewed and tested, but mistakes happen. See the [Disclaimer](docs/DISCLAIMER.md) for the specific accuracy caveats (genre best-effort, English-only assumptions, test-data leakage, unsigned-commit dev artefacts).

**Wallet safe (for now). Play at your own risk.**

### Project status

> [!NOTE]
> **Stable, maintenance only (since 2026-11-11).** The project does what it set
> out to do, so it is finished rather than abandoned: the pipeline keeps the
> list fresh every day, and the site and apps stay up.
>
> - **No new features.** Feature requests are not taken, as issues or as pull requests.
> - **Code changes only for** security advisories (CVEs), runtime and dependency
>   updates, and whatever those break.
> - **Issues and pull requests are for the data:** adding a game, correcting
>   one, removing one. Something broken or an accessibility barrier can still be
>   reported; it gets a fix, not a redesign.
> - A vulnerability goes through [`SECURITY.md`](SECURITY.md), never a public issue.
>
> Details in [`CONTRIBUTING.md`](CONTRIBUTING.md).

### Quick links

| Surface              | URL                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 🌐 Web app          | <https://free-steam-games.win/>                                                                  |
| 🖥️ Desktop releases  | [GitHub Releases](https://github.com/poli0981/free-steam-games-list/releases) (Win `.msi` / `.exe`, Mac `.dmg`, Linux `.AppImage` / `.deb` / `.rpm`) |
| 📱 Android APK      | [GitHub Releases](https://github.com/poli0981/free-steam-games-list/releases) (sideload `.apk`, **Android 11+** — see [`docs/android-support.md`](docs/android-support.md)) |
| 🏆 Top online (md)  | [games/top-online.md](games/top-online.md)                                                                           |
| 🎯 Top offline (md) | [games/top-offline.md](games/top-offline.md)                                                                         |
| 📦 Raw data         | [data/](data/) — JSONL shards of 800 games each (`data_001.jsonl` …), listed with a SHA-256 each in [`data/index.json`](data/index.json) |
| 🛠️ About            | <https://free-steam-games.win/about> (in-app)                                                   |
| 👤 Authors          | [`AUTHORS.md`](AUTHORS.md) — maintainer + contact channels + AI-assistant disclosure                                 |
| ♿ Accessibility    | [`ACCESSIBILITY.md`](ACCESSIBILITY.md) — what works with a keyboard, screen reader and zoom, what doesn't yet, how to report a barrier |

### What's in v4

<details>
<summary><b>Web app at <code>free-steam-games.win/</code></b></summary>

A SvelteKit 3 / Svelte 5 app, prerendered and served by a Cloudflare Worker that also proxies the dataset (`/api/data/*`) and Steam artwork (`/img/*`; on the website the art comes from the site's own media host, `media.free-steam-games.win`), so your browser talks to this site only — apart from Cloudflare's analytics beacon and its Turnstile human check, both loaded only after you accept the terms. Features:

- **Browse** — virtualised table (TanStack Virtual), filters for genre, type, platform, status, anti-cheat and safety, Fuse.js fuzzy search, sortable columns, 50/100/200/500/all pages. Filters live in the URL, so a filtered view can be shared.
- **Charts** — Apache ECharts: dashboard KPIs, genres, platforms, languages, tags, anti-cheat (chart and a searchable index), reviews, player tiers, release years and catalogue growth, DRM/DLC, delisted games, plus a stats page (Metacritic, retention, games that went quiet).
- **A page per game** — `/games/:appid` is prerendered for search engines and filled with live player counts and reviews in the browser.
- **Random games** — `/random` rolls one to five games when you cannot decide: online, offline or either, dead games only if you ask, never one marked unsafe. Roll again for a new set; opening a game and coming back keeps the picks.
- **Fresh data, verified** — `data/index.json` carries a SHA-256 per shard; the app only caches a generation it could verify, keeps the last good one offline, and re-checks when you come back to the tab.
- **Installable** — a web app you can install, with an offline mode and an update prompt.
- **i18n** vi / en — auto-detected, switchable from the welcome page or Settings.
- **⌘K command palette**, **first-run introduction**, and the legal documents rendered in the app.

Cloudflare Workers Builds deploys from `main`; which commits trigger a build is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Pipeline commits to `data/**` do not need a rebuild: the data is proxied, not bundled.

</details>

<details>
<summary><b>Desktop and Android apps (Tauri 2)</b></summary>

A native shell around the same web app, distributed via [GitHub Releases](https://github.com/poli0981/free-steam-games-list/releases):

- Windows `.msi` and `-setup.exe`, macOS `.dmg` (universal Apple Silicon + Intel), Linux `.AppImage`, `.deb` and `.rpm`, and an Android `.apk`.
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
<summary><b>The admin at <code>/admin</code></b></summary>

`Discover New Games` sweeps the Steam store daily for free games in every language, not only the ones that support English, and proposes candidates into a Cloudflare D1 queue. The maintainer reviews them in a small Svelte app embedded in the Worker (never shipped to visitors): approving commits the store link to `scripts/temp_info.jsonl`, and the pipeline does the rest, checking every game again (free, a game, reachable) before it is published. Approval can also run on its own, in batches with a daily cap, once the maintainer turns it on. Decided and already-published rows are read-only. Corrections to published games are saved as override files that survive every pipeline run, and a removed game goes into `data/blocklist.jsonl`, which keeps it out of the catalogue until it is restored. An overview, the pipeline's runs and a data-quality report complete it. See [`docs/ADMIN.md`](docs/ADMIN.md).

</details>

<details>
<summary><b>v2.x foundations still here</b></summary>

The Python pipeline that powered v2 is untouched and runs daily as before:

- Schema v2.2 (23 + manual fields per record), CC BY 4.0 (see [LICENSE-DATA](LICENSE-DATA)), sharded data in `data/data_*.jsonl` (cap 800 records/shard) plus a `data/index.json` manifest with a SHA-256 per shard.
- HTML scraper for accurate language tables, DLC pricing, user tags and the developer's anti-cheat disclosure — single GET per game.
- Health-checked daily: Steam's store API screens every game, and a game is removed only when appdetails agrees.
- Reviews refreshed daily from Steam's own summaries; full refresh daily. Every data job queues for its turn and has a time budget, so a growing catalogue slows a refresh down instead of breaking it ([plan](docs/plan/18-pipeline-scale.md)).

</details>

<details>
<summary><b>Architecture</b></summary>

```
.
├── data/                       # Sharded data (the source of truth)
│   ├── data_001.jsonl …        # 800 records per shard, as many shards as it takes
│   ├── index.json              # last_updated, totals, shard manifest (SHA-256 each)
│   ├── blocklist.jsonl         # removed games, kept out of every write
│   ├── overrides/              # human corrections, re-applied on every write
│   └── snapshots/              # daily per-game players and reviews
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
├── docs/                       # Legal, setup and ops docs, plans (plan/), Vietnamese copies (i18n/vi/)
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
│   ├── blocklist.py        # Removed games, left out of every write
│   ├── fetcher.py          # Batch processor, apply_details/reviews/players/scraped
│   ├── scraper.py          # Store page HTML parser (languages, DLC, tags, anti-cheat)
│   ├── anticheat.py        # Steam's anti-cheat disclosure and the rule that applies it
│   ├── steamcharts.py      # SteamCharts all-time peak reader (polite, stops on refusal)
│   ├── peaks.py            # all_time_peak: only ever raised
│   ├── rotation.py         # crc32 daily slices shared by the refresh jobs, growing with the catalogue
│   ├── budget.py           # A job's time budget: stop in time to save, warn before it runs out
│   └── health_checker.py   # Game status detection with cached API data
├── discover_new.py         # Propose new games into the /admin review queue
├── ingest_new.py           # Add queued games (health check + fetch from Steam)
├── remove_games.py         # Apply data/blocklist.jsonl now (runs before every ingest)
├── update_data.py          # Daily: fill in incomplete records
├── refresh_store_data.py   # Daily rotation: tags/languages weekly, store details monthly
├── refresh_anticheat.py    # Daily: every game's anti-cheat, as its developer declares it on Steam
├── refresh_peaks.py        # Daily rotation: all-time peak from SteamCharts, monthly per game
├── update_reviews.py       # Daily: every game's review summary from Steam, ~2 minutes
├── mark_dead_games.py      # Flag online games with no players
├── purge_unhealthy.py      # Daily: remove delisted/not-free/unreleased (store API screen + appdetails)
├── top_online.py / top_offline.py  # Leaderboards
├── edit_game.py            # Overrides from the command line
├── refetch_all.py          # Force re-fetch, in parts (manual only)
└── delete_game.py          # Remove games (blocklist) from the command line
```

</details>

### Automated workflows

| Workflow              | Trigger                          | What it does                                              |
| --------------------- | -------------------------------- | --------------------------------------------------------- |
| Auto Update JSON      | Daily 00:00 UTC                  | Fills in incomplete records (API + HTML scrape)           |
| Discover New Games    | Daily 05:00 UTC                  | Propose new free games, any language, to the `/admin` queue |
| Ingest New            | On `scripts/temp_info.jsonl` or `data/blocklist.jsonl` push, and every 3 h | Apply removals, then add approved games |
| Top Online            | Sun/Wed/Fri 03:00 UTC            | Live player leaderboard                                   |
| Top Offline           | 1st + 15th of month 05:00 UTC    | Leaderboard for single-player F2P concurrents             |
| Update Reviews        | Daily 06:00 UTC                  | Every game's review summary from Steam's store API        |
| Refresh Store Data    | Daily 16:00 UTC                  | Rotating re-fetch: tags, languages, DLC flag weekly; name, image, description, developer/publisher, release date, platforms, Metacritic, DRM monthly. Then every game's anti-cheat from Steam's disclosure (committed separately; manual run with `only: anticheat` does just that) |
| Refresh All-Time Peaks | Daily 19:30 UTC                 | `all_time_peak` from SteamCharts, every game once a month, plus our own samples; manual run with `backfill` asks about every game |
| Purge Unhealthy       | Daily 07:00 UTC                  | Store API screen of every game; removal once appdetails agrees |
| Mark Dead Games       | Mon + Thu 04:30 UTC              | Online + >1y + 0 players ≥14d → `is_dead=true` + 💀 note |
| Daily Snapshot        | Daily 23:00 UTC                  | Per-game players and reviews into `data/snapshots/`       |
| Force Re-fetch        | Manual only                      | Re-fetch games from scratch, one part (`1/8` … `8/8`) a run |
| Web CI / Python Tests | On `web/**` / `scripts/**` change | Type check, tests, build and output checks               |
| Release Desktop / Android | On `desktop-v*` / `android-v*` tag | Build the apps into a draft release                  |
| Announce Discussion   | On release `published`           | Auto-create a GitHub Discussion in `Announcements`        |

Also in `.github/workflows/`:
- **CodeQL** and **SonarCloud**: code scanning on pushes and pull requests.
- **Check Overrides**: pull requests that touch the override or blocklist files.
- **Backfill Discovery**: temporary; a weekly re-sweep of older release windows into the same `/admin` queue.
- **Announce Release to Discord**: posts each published release.
- Three **Notify** workflows: CI failures, the Pages deploy, the release pipeline.
- **Deploy Web (GitHub Pages)**: it only serves a redirect to the new site now.

The site itself is deployed by Cloudflare Workers Builds, not by a workflow.

### Contribute

The repository is in [maintenance mode](#project-status): contributions are
about the **data**.

New games arrive on their own: `Discover New Games` sweeps the Steam store
daily, in every language, into a review queue, and the maintainer approves them at `/admin` — by
hand, or with an auto-approve rule that has a daily cap and is off until turned
on. Discovery only proposes, and every approved game is checked again by the
pipeline (free, a game, reachable) before it is published.

| You want to | Issue form | Or a pull request that |
| --- | --- | --- |
| **Add** a free game that is still missing a few days after it went free | [Add game](.github/ISSUE_TEMPLATE/add_game.yml) | appends its store link to `scripts/temp_info.jsonl` |
| **Correct** a published game (genre, type, anti-cheat, notes, safe) | [Edit game](.github/ISSUE_TEMPLATE/edit_game.yml) | adds an override with `python scripts/edit_game.py <appid> --set field=value --reason "…"` |
| **Remove** a game (paid now, not a game, malware, duplicate) | [Delete game](.github/ISSUE_TEMPLATE/delete_game.yml) | adds a blocklist line with `python scripts/delete_game.py <appid> --reason <code>` |

```jsonl
{"link": "730"}
{"link": "https://store.steampowered.com/app/570/"}
```

A queued line accepts a full URL, short URL, or bare appid, and is a link and nothing else: any other key is ignored, and the game is fetched from Steam. Never edit `data/data_*.jsonl` or `data/index.json` by hand: the pipeline rewrites them, and an edit there is lost.

Two more forms stay open, for things that are broken rather than wished for:
[Bug report](.github/ISSUE_TEMPLATE/bug_report.yml) and
[Accessibility barrier](.github/ISSUE_TEMPLATE/accessibility.yml). All reviewed by hand.

The companion browser extension, [steam-f2p-extension](https://github.com/poli0981/steam-f2p-extension),
is archived and no longer a way in.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full flow.

### Why this exists

Unemployed, introvert max level, dropped out uni year 3, mooching off family. Needed a clean F2P list without digging Steam every time "hôm nay chơi free cái gì đây". So this repo was born — hobby project of a "barely competent" dev pumped by AI.

- v1 was spaghetti.
- v2.0 was organised spaghetti.
- v2.1 was spaghetti with proper seasoning. It got a scraper.
- v3.0 was spaghetti with a website on top, a desktop app, and bilingual menus.
- **v4.0 is the same spaghetti, rebuilt, with a review queue so it stops needing to be cooked by hand.** Still a hobby.
- v4.7 is where the cooking stops: the dish is served, and from here it is only kept warm.

> [!WARNING]
> **Disclaimer.** Quality / fun / safety: who knows. The maintainer only vouches for games personally played (`safe` column: `y` = yes, `?` = dunno, `n` = nope). Problems with a game are between you, Valve, and the developer of that game — not the maintainer. See [`docs/DISCLAIMER.md`](docs/DISCLAIMER.md) for the specific accuracy caveats.

### Docs

- [AUTHORS](AUTHORS.md) — maintainer + canonical handle map + AI-assistant disclosure.
- [CHANGELOG](CHANGELOG.md) — what changed in each version.
- [CONTRIBUTING](CONTRIBUTING.md) — maintenance mode, what is accepted, and how to add, correct or remove a game.
- [PC spec](docs/pc_spec.md) ([VI](docs/i18n/vi/pc_spec.md)) — maintainer's dev hardware + test devices.
- [Dev environment](docs/dev_env.md) ([VI](docs/i18n/vi/dev_env.md)) — IDE, toolchains (Python 3.15 / Node 26 / TypeScript 7 / Rust stable / Tauri 2), workflow.
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
- [Security setup](docs/SECURITY_SETUP.md) — the operational side: headers, WAF, rate limits, Access, each with a check command.
- [ACCESSIBILITY](ACCESSIBILITY.md) — what works with a keyboard, screen reader and zoom, what doesn't yet, and how to report a barrier.
- [Android support](docs/android-support.md) ([VI](docs/i18n/vi/android-support.md)) — why Android 11+, and what the APK is tested on.
- [`web/README.md`](web/README.md) — web stack, data paths, CSP, PWA, i18n, build and checks.

Code is [MIT](LICENSE); the dataset is [CC BY 4.0](LICENSE-DATA) with carve-outs for fields the project does not own (`description`, `header_image`). Keep the right licence with you if you fork. Star if you find a hidden gem ✨

Last auto-update: daily via GitHub Actions. Manual runs from the [Actions tab](../../actions).