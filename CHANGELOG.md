# Changelog

All notable changes to this awesome noob repo will be documented here.

## [v2.0.0] - 2026-03-26 (The "Finally Got Serious" Edition)

### 💥 Breaking Changes
- Data format migrated from `data.json` to `data.jsonl` (JSON Lines). Old scripts won't work – use the new ones.
- All Python scripts rewritten from scratch under `scripts/core/` modular architecture.
- Bash scripts rewritten with `set -euo pipefail` – no more silent failures.
- Workflow names changed – old workflow references in forks will break.

### 🏗️ Architecture (Complete Rewrite)
- **Modular core package** (`scripts/core/`) – 5 modules, zero spaghetti:
  - `constants.py` – all config centralized, auto-detects CI environment for rate tuning.
  - `steam_client.py` – HTTP client with exponential backoff + jitter, `Retry-After` header respect, separate rate buckets for Store API (~1.5s/req) vs Web API key (~0.5s/req), session connection pooling.
  - `data_store.py` – atomic JSONL I/O (write-tmp → rename), link normalization (accepts full URL / short URL / bare appid), O(1) duplicate check via `build_index()`.
  - `fetcher.py` – batch processor with inter-batch cooldown (15-30s), smart skip for already-complete records, separate `update_all_full()` / `update_reviews_only()` / `update_players_only()` functions.
  - `health_checker.py` – single source of truth for game status detection (see below).

### 🔍 Health Detection System (New)
- Central `health_checker.py` module detects 5 unhealthy statuses:
  - `invalid_format` – link can't be parsed to an appid.
  - `not_found_404` – Steam store page returns 404.
  - `not_found_410` – Steam store page returns 410 Gone.
  - `unavailable` – `appdetails` API returns `success: false` (delisted/region-locked).
  - `not_free` – game exists but `is_free=false` and `price > 0`.
  - `network_error` – transient, game is NOT removed (retry later).
- `purge_unhealthy.py` – full scan of `data.jsonl`, removes unhealthy games, logs to `scripts/removed_games.jsonl` with `[link, reason, removed_at]`.
- `check_dead_links.py` – lightweight HEAD-request scanner, marks 404/410 as `status: "delisted"` without removing.
- Ingest pipeline (`ingest_new.py`) now runs **pre-flight health check** before adding any game – rejects dead/delisted/not-free links immediately + logs to `removed_games.jsonl`.

### ➕ New Game Ingest Flow
- New flow: `temp_info.jsonl` → validate → dedup → health check → fetch → `data.jsonl`.
- Supports manual fields in `temp_info.jsonl` entries: `anti_cheat`, `notes`, `type_game`, `genre`, `safe` – values are preserved through fetch (applied before AND re-applied after Steam fetch).
- Link format flexible: accepts full Steam URL, short URL, or bare appid number.
- Invalid/duplicate/unhealthy links are rejected immediately with clear log messages.
- Auto-triggers on push to `scripts/temp_info.jsonl` via `ingest-new.yml` workflow.

### 📊 New Table Columns
- **Metacritic** – score pulled from Steam `appdetails` API.
- **DRM Notes** – auto-detected from Steam categories ("Requires 3rd-party account", etc.).
- **Peak Today** – tracks daily peak concurrent players.
- **Status** – visual icon: ✅ active, 💀 delisted, 💰 no longer free.

### 🏆 Top Online Leaderboard (Upgraded)
- Trend arrows with percentage: 📈 +25%, ↓ -8%, → stable, 🆕 new.
- Tier badges by population: 🔥 Mega (100k+), ⭐ Hot (30k+), 🟢 Healthy (10k+), 🟡 Stable (3k+), 🟠 Low (500+), 🔴 Dying (50+), 💀 Dead.
- Star rating from reviews: ★★★★★ to ☆☆☆☆☆.
- Summary stats header: total players, average per game, tier distribution, top genres, anti-cheat breakdown.
- `games/README.md` index file with genre table + links to all generated files.

### 🤖 New CI/CD Workflows
- `update-reviews.yml` – reviews-only update every 2 days (`0 6 */2 * *`). Lighter than full fetch.
- `check-dead-links.yml` – HEAD-request dead link check every 5 days.
- `purge-unhealthy.yml` – full health scan + removal, weekly (Monday 05:00 UTC).
- `ingest-from-issue.yml` – GitHub Issue trigger: issues titled `[add-game]` are auto-parsed, ingested, and closed with result comment (prepares for browser extension).
- All existing workflows rewritten for consistency + `set -euo pipefail`.

### 🛡️ Anti-Ban / Rate Limiting
- Store API: ~1.2-2s delay between requests (Steam limit ~200 req/5 min).
- Web API (with key): 0.3-0.8s delay (100k/day quota).
- Batch 50 games/batch, 15-30s pause between batches.
- Exponential backoff (2^attempt + random jitter) on errors.
- 429: reads `Retry-After` header, fallback 60s wait.
- Session reuse with connection pooling (no new TCP per request).

### 🧹 Improved
- `delete_game.py` – now supports search by name/appid/link, shows matches, asks confirmation before delete.
- `export_data.py` – reads JSONL format, cleaner output.
- `generate_tables.py` – uses `<img>` tags for thumbnails (width=120), produces `games/README.md` index.
- All bash scripts use `pip install --quiet` and `set -euo pipefail`.
- Git commit messages include timestamps.

### 📝 Logging
- `scripts/dead_links.log` – append-only log of dead link check results.
- `scripts/removed_games.jsonl` – structured log of all removed/rejected games with reason + timestamp.

---

## [v1.1.2] - 2026-01-11

## Added
- 40+ games.

## [v1.1.1] - 2026-01-07

## Added
- 50+ games. (by [@poli0981](https://github.com/poli0981))
- Delete game script: Delete a game with correct input link. (by [@poli0981](https://github.com/poli0981))
- Check dups script: Check game info duplication. (by [@poli0981](https://github.com/poli0981))
- Export JSON file to CSV/XLSX. (by [@poli0981](https://github.com/poli0981))
- Auto update CSV file use Actions. (by [@poli0981](https://github.com/poli0981))

## Fixed
- Delete 3 duplicates link game. (by [@poli0981](https://github.com/poli0981))

## Improved
- Use bash to help code workflow shorter. (by [@poli0981](https://github.com/poli0981))
- Add `export-ignore` in `.gitattributes`. (by [@poli0981](https://github.com/poli0981))
- Fix link to direct to `all-games_part[x].md`. (by [@poli0981](https://github.com/poli0981))

## [v1.1.0] - 2025-12-30 (Scale Noob Edition)

### Added

- Split all-games.md into parts when >200 games (part1, part2...) – mobile friendly, no more endless scroll hell.
- Smarter fetch: Skip games with full info (reviews/players/developer/etc.) – faster daily update, less Steam throttle
  risk.
- Full Wiki (English, noob friendly) – Home, FAQ, Code Explanation, Test Branch troll, Future Plans (you guess?), etc.
- More issue templates: Delete Games + Feedback/Rant – clean garbage + stress reliefrepo "like shit".
- CONTRIBUTING.md updated – "so easy" with issue forms.

### Improved

- Tables robust more (safe fallback name/thumbnail, no KeyError crash Action).
- Fetch batch + delay optimize – scale 500+ games ok, good, no timeout die.

### Fixed

- Various Action trolls (no commit clean, closed file, Unknown spam) – thanks Grok buddy fix 99%.

Thanks contributors (if any :))) ) – this broke unemployed dev appreciates stars + coffee donate.

Previous: [v1.0.0] – Initial stable, auto tables, templates, donate?.

Made with boredom, instant noodles, sale addiction, and AI power ✨