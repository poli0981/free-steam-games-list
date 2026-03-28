# Changelog

All notable changes to this awesome noob repo will be documented here.

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