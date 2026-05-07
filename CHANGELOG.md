# Changelog

All notable changes to this awesome noob repo will be documented here.

## [v3.0.0] – 2026-05-07 (The "It Has a Website Now" Edition)

The repo is no longer just a list. It is a **list + a React/Vite web app + a Tauri desktop app**, all reading the same Python-pipeline-maintained data.

### 🌐 Web app — `web/` + GitHub Pages

Built across phases 1 → 7. Live at <https://poli0981.github.io/free-steam-games-list/>.

- **Phase 1** — read-only browse: virtualised 1.2k-row TanStack table, faceted filters, Fuse.js fuzzy search, 4 ECharts MVP charts (KPI, top-online, genre treemap, platform donut), GitHub Pages deploy via `actions/deploy-pages`.
- **Phase 2** — PAT-based GitHub auth, single-record edit drawer for the 8 manual fields, diff viewer, single + bulk Steam-link queue into `scripts/temp_info.jsonl`, conflict-retry, sonner toasts.
- **Phase 3** — client-side OpenPGP signing via Git Data API: switched all writes from Contents API to `commitFile(getHead → createBlob → createTree → buildCommitContent → openpgp.sign → createCommit → updateRef)`. Settings panel with passphrase unlock + lock indicator. Earlier claim that PATs auto-sign was wrong — Contents API commits land Unverified.
- **Phase 4** — fixed GPG salt-notation incompatibility (`config.nonDeterministicSignaturesViaNotation: false`) so OpenPGP.js v6 signatures parse on GitHub. Bulk edit + bulk delete in one signed multi-shard commit. 8 remaining charts (tags wordcloud, AC stacked, languages heatmap, release-year histogram, catalog-growth cumulative line, reviews histogram, online player tiers pie, DRM/DLC bars). Health page with workflow_dispatch buttons. ⌘K command palette (cmdk).
- **Phase 4.1** — GPG signature payload fix: dropped trailing `\n` after the commit message so our signed bytes match `verification.payload` byte-for-byte. Verified via `gh api .../commits/{sha}.commit.verification.reason → valid`.
- **Phase 5** — PWA (installable, offline shell + last-known data via Workbox), GPG identity override (multi-UID picker), GPG idle auto-lock 5/15/30/60 min, Activity feed page (`/activity`) with Verified-status badges + Me/Bots/All filters.
- **Phase 6** — curated enums (`ANTI_CHEAT_ENUM`, `GENRE_ENUM`) + dropdowns, JSON-editor toggle in the edit drawer (full-record replace), manual-field overrides on Add (single + bulk JSON mode propagates `genre/type_game/anti_cheat/notes/safe` straight into `temp_info.jsonl`), GamesTable pagination 50/100/200/500/all + hidden scrollbar + per-row validation badge, per-game permalinks `/games/:appid` with friendly 404 drawer, verify-after-commit polling (toast updates with `verification.reason` once GitHub confirms), CSV/JSON export of the filtered subset, About page (repo + dev info from `username.txt` + 3rd-party stack + issue templates), topbar GPG quick-unlock popover, owner-gate (`useIsOwner` + `OWNER_LOGIN`) hides edit/add/delete UI from non-owners.
- **Phase 6.1** — Edit Always Failing fix: Contents API caps `content` at 1 MB; `data/data_001.jsonl` is 1.49 MB so the read came back empty and every edit threw "Record not found". New `getRepoFileText()` helper falls back to the `/git/blobs/{sha}` endpoint for oversize files.
- **Phase 6.2** — stale-after-edit fix: bumped `data/index.json.last_updated` in every shard-modifying commit AND switched the SW cache to `NetworkFirst` (raw.github CDN is Fastly-cached for 5 min). Plus optimistic-update helpers (`optimisticEdit/Replace/BulkEdit/BulkDelete`) write straight to TanStack + IndexedDB so the editor sees their own change instantly without waiting for the CDN.
- **Phase 7** — date-column sort fix (`parseReleaseDate`), hamburger mobile nav (Sheet drawer, auto-close on route change), About expansion (Heads-up caveats + AI disclosure + legal links + per-third-party SPDX licence badges), legal docs rewritten (DISCLAIMER + EULA + ToS + PRIVACY) with the four caveats from `notes.txt` (genre best-effort, English-only, test-data leakage, unsigned-commit dev artefacts), refreshed `bug_report.yml`, workflow Node 20 → 24 + actions versions bumped.

### 🌍 i18n — vi / en (Phase 8, this release)

- `react-i18next` + `i18next-browser-languagedetector`. Resource files `src/i18n/locales/{en,vi}.json`.
- Auto-detect from `navigator.language` on first load; persistent override via Settings → Language.
- Sidebar nav, Topbar, Settings, Dashboard, Top Online, common buttons, common toast strings translated. Long-form legal copy stays English by design (legal review hard to mirror exactly across two languages).

### 🖥️ Desktop app — Tauri 2 (Phase 8, this release)

- `web/src-tauri/` Rust scaffold targeting Tauri 2. Single `main` window, fixed 1400 × 900, no resize, no maximise, dark theme, centred at startup.
- `tauri-plugin-shell` for opening external links to Steam / GitHub from the embedded UI.
- New `release-desktop.yml` workflow: matrix `ubuntu-latest` / `windows-latest` / `macos-latest`, Apple Silicon + Intel universal binaries, `tauri-apps/tauri-action`. Triggered by `desktop-v*` tags or manual workflow run. Each run creates a draft GitHub Release with `.msi` / `.dmg` / `.AppImage` / `.deb` assets.
- `npm run tauri:dev` and `npm run tauri:build` from `web/` for local builds.

### 📦 Versioning

- Repo version badge **2.1.0 → 3.0.0**.
- `web/package.json` **0.1.0 → 1.0.0** (web app considered first-stable).
- `web/src-tauri/Cargo.toml` and `tauri.conf.json` ship at `1.0.0`.

### 📝 Docs (this release)

- `README.md` — rewrite: web app + desktop sections, updated Quick Links table, new architecture diagram, refreshed contribute paths, refreshed docs index.
- `CHANGELOG.md` — this entry consolidating phases 1 → 8.
- `docs/ACKNOWLEDGEMENTs.md` — refreshed with phase-by-phase AI assistance breakdown (Grok v1; Claude for v2 + the entire web/desktop layer + this changelog).
- `web/README.md` — phase 8 status appended.

### 🛠️ Pipelines unchanged

- All 9 v2.x Python pipeline workflows (update-json, generate-tables, top-online, update-reviews, dead-link-check, purge-unhealthy, ingest-new, ingest-from-issue, refetch-all) keep their schedules and behaviour. Two new workflows added: `deploy-pages.yml` (Phase 1) and `release-desktop.yml` (Phase 8).

---

## [v2.1.0] - 2026-03-28 (The "Extension-Ready + Performance" Edition)

### 💥 Breaking Changes

- `desc` field **removed** from schema. Use `description` only. Migration script handles upgrade automatically.
- `free_type` field removed (unreliable from API, extension handles classification client-side).
- `jsonlines` pip dependency dropped – all I/O now uses stdlib `json` (faster, zero deps).
- `fetcher.py` function renamed: `_process_batch()` → `process_batch()` (public API).

### 🏗️ Schema v2.1 (Extension-Compatible)

- **7 new fields** added to every game record, matching Chrome extension output:
    - `publisher` (list) – e.g. `["Square Enix", "Feral Interactive (Mac)"]`
    - `platforms` (list) – e.g. `["Windows", "macOS", "Linux"]`
    - `languages` (list) – e.g. `["English", "French", "Japanese"]`
    - `language_details` (list[dict]) – per-language `{name, interface, audio, subtitles}` booleans
    - `tags` (list) – all user-defined Steam tags including hidden overflow
    - `anti_cheat_note` (str) – raw anti-cheat name from store page
    - `is_kernel_ac` (bool|null) – `true` = kernel-level, `false` = non-kernel, `null` = unknown
- `developer` normalized: string → list everywhere (API, extension, migration).
- `desc` merged into `description`, then dropped. One field, no duplication.

### 🔌 Extension Data Integration

- New `merge_extension_data()` in `data_store.py` – smart merge with 3-tier priority:
    - **MANUAL_FIELDS** (notes, safe, type_game, genre, anti_cheat): only fill if empty (preserves user edits).
    - **ARRAY_FIELDS** (developer, publisher, platforms, languages, tags): replace wholesale (extension data is richer).
    - **Other fields**: overwrite if extension provides non-empty value.
- `ingest_new.py` now accepts full extension output (20+ fields per entry) – merges before fetch, re-applies manual
  overrides after fetch.
- Ingest summary shows field counts: `dev=DONTNOD plat=[Windows, macOS, Linux] langs=6 tags=20`.

### 🔍 HTML Scraper (New Module)

- New `scraper.py` – extracts data unavailable from Steam API:
    - **Language table**: parses `<table class="game_language_options">` → accurate Interface/Audio/Subtitles per
      language (API only gives a broken HTML string with no subtitle info).
    - **DLC pricing**: parses `#gameAreaDLCSection` → checks `data-price-final` per DLC row. Only marks
      `has_paid_dlc=true` if at least one DLC has actual non-zero price (API just lists DLC IDs with no prices).
    - **Tags**: parses `.app_tag` elements including `display:none` overflow tags (API `appdetails` doesn't return user
      tags at all).
- All 3 extracted from **single GET request** to store page – one HTML fetch per game, not three.
- 8 regex patterns pre-compiled at module level.

### ⚡ Performance Optimizations

- **Eliminated double-fetch in ingest**: `health_checker` now caches API response in `HealthResult.data`.
  `ingest_new.py` passes `prefetched_details=health.data` to `fetch_full()` → skips redundant `fetch_app_details()`
  call. Saves 1 API request per game (300 games = ~450s saved).
- **Dropped jsonlines dependency**: `load_jsonl()` uses `json.loads()` line-by-line, `save_jsonl()` uses
  `json.dumps()` + `f.write()` directly. ~20-30% faster I/O for large files, zero pip deps for core.
- **Pre-compiled regex**: `scraper.py` compiles all 8 patterns at import time, not per-call. 300 games = 8 compiles
  instead of 2400.
- **Faster `is_empty()`**: uses `frozenset` lookup for empty string variants, early returns for `None`/`list`.
- **`SteamClient.__slots__`**: reduced memory per instance, faster attribute access.
- **`extract_appid()` regex simplified**: `/app/(\d+)` instead of full domain match – shorter, same correctness.
- **`make_skeleton()` template**: shallow-copies from frozen template dict instead of building from scratch.
- **`generate_tables.py`**: `lines.extend(generator)` instead of `append()` loop.

### 🔄 New Scripts & Workflows

- `refetch_all.py` + `refetch-all.yml` – **manual-only** force re-fetch of ALL games into v2.1 schema. Creates backup →
  migrates → clears fetchable fields → re-fetches from Steam API + HTML scrape. Preserves manual fields (notes, safe,
  type_game). Requires typing `"yes"` to confirm. Timeout: 120 minutes.
- `migrate_schema.py` + `migrate-schema.yml` – upgrades existing `data.jsonl` records: adds missing fields, normalizes
  types, drops deprecated fields. Idempotent.

### 🐛 Bug Fixes

- **`languages` corrupted**: API HTML string `"Brazil<br>languages with full audio"` was parsed as
  `"Brazillanguages..."`. Fixed by switching to HTML table scraping.
- **`subtitles` always `false`**: API has no subtitle breakdown. Fixed by parsing store page language table (
  Interface/Audio/Subtitles columns).
- **`has_paid_dlc` false positives**: Games with free-only DLC were marked `true`. Fixed by scraping actual
  `data-price-final` attributes.
- **`description` duplicated**: Both `desc` and `description` stored same text. Unified to `description` only.

### 🧹 Improved

- Tables: Publisher column, Platforms column, Language count, kernel anti-cheat badge (🔴/🟢).
- `health_checker.py`: `@dataclass(slots=True)` for leaner objects.
- `top_online.py`: tier thresholds as tuple list (cleaner).
- All scripts: consistent `sys.path.insert(0, ...)` for imports.

---

## [v2.0.0] - 2026-03-26 (The "Finally Got Serious" Edition)

### 💥 Breaking Changes

- Data format migrated from `data.json` to `data.jsonl` (JSON Lines).
- All Python scripts rewritten from scratch under `scripts/core/` modular architecture.
- Bash scripts rewritten with `set -euo pipefail`.

### 🏗️ Architecture (Complete Rewrite)

- Modular core: `constants.py`, `steam_client.py`, `data_store.py`, `fetcher.py`, `health_checker.py`.
- Rate-limited HTTP client with backoff, retry, 429 handling, session pooling.
- Health detection (5 statuses), purge, dead link check, pre-flight ingest validation.
- New ingest flow: `temp_info.jsonl` → validate → dedup → health check → fetch → `data.jsonl`.
- 9 CI/CD workflows. Metacritic, DRM, Peak Today, Status columns. Top Online leaderboard with trends.

---

## [v1.1.2] - 2026-01-11

- 40+ games added.

## [v1.1.1] - 2026-01-07

- 50+ games, delete/dedup scripts, CSV export, auto CSV Actions. (by [@poli0981](https://github.com/poli0981))

## [v1.1.0] - 2025-12-30 (Scale Noob Edition)

- Split all-games.md into parts. Smart fetch skip. Wiki. Issue templates.
- Batch + delay optimize for 500+ games. Various Action fixes.

Previous: [v1.0.0] – Initial stable.

Made with boredom, instant noodles, sale addiction, and AI power ✨