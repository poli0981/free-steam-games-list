# CLAUDE.md — free-steam-games-list

Load-bearing facts about this repo. Every claim here was verified against the
code; if you change the code, change this file.

## What this is

A dataset of free-to-play Steam games (`data/data_*.jsonl`) plus a React SPA
(`web/`), a Tauri 2 desktop/Android shell (`web/src-tauri/`), and a Python
scraping pipeline (`scripts/`) driven by GitHub Actions.

**Git is the source of truth for game data.** Nothing else is. Keep it that way.

## Data invariants — get these wrong and you corrupt the dataset

- **`appid` is not a stored field.** It is parsed out of `link` with
  `/\/app\/(\d+)/` (`web/src/lib/data-store.ts`, `extract_appid` in
  `scripts/core/data_store.py`). Never add it as a column; derive it.

- **Numeric-looking fields are formatted strings, not numbers.**
  `current_players: "492,197"`, `reviews: "86% (Very Positive)"`,
  `metacritic: "N/A"`. Parse before comparing or sorting.

- **`MANUAL_FIELDS` are human judgements and are never overwritten by a
  refetch.** They are `anti_cheat`, `anti_cheat_note`, `is_kernel_ac`, `notes`,
  `type_game`, `safe`, `genre`. The guard is `scripts/core/data_store.py`
  (merge fills them only when currently empty) and `scripts/ingest_new.py`
  (re-applies them as overrides). A scraper that clobbers these destroys work
  that cannot be re-derived.

- **Shard assignment is unstable.** `save_main()` re-chunks the entire record
  list into 800-record files from scratch on every run and deletes leftovers.
  A game moves between `data_001.jsonl` and `data_005.jsonl` as records before
  it are added or removed. Never persist "game X lives in shard N".

- **`data/index.json.last_updated` is the only cache-invalidation signal.**
  `web/src/lib/cache.ts` keys its IndexedDB cache on it. Commit a shard without
  bumping it and every browser keeps serving pre-edit records. Anything that
  writes a shard must also bump it.

- **`index.json` must be updated by spreading, never by reconstruction.**
  `bumpedIndexFile()` in `web/src/lib/edits.ts` previously rebuilt the object
  from a hardcoded key list, silently deleting every other key on write. Keep
  it additive.

- **`web/src/lib/schema.ts` mirrors `scripts/core/constants.py`.** `MANUAL_FIELDS`,
  `ARRAY_FIELDS`, `EXTENSION_FIELDS` and the record shape exist in both. Change
  one, change the other.

## Pipeline

- `update_data.py` only **enriches existing records**. It does not discover new
  games.
- `ingest_new.py` only reads `scripts/temp_info.jsonl`, which is filled by a
  human path (issue template, Telegram bot, browser extension, or the `/add`
  page). **There is no automatic discovery of new F2P games** — `steam_client.py`
  has no endpoint that works without an `appid` you already have.
- Every workflow that writes to `data/` shares `concurrency: {group: data-write}`.
  A new data-writing workflow without it will race jobs that run ~2 hours.
- Workflows push with the built-in `GITHUB_TOKEN`; each declares
  `permissions: {contents: write}`. Do not reintroduce a PAT — a PAT expiring
  silently is what stalled the pipeline for a month in 2026.

## Frontend gotchas

- **Never pass `theme="dark"` to `<ReactEChartsCore>`.** `echarts/core` ships no
  registered themes. Under echarts 6 an unregistered theme name silently stops
  every series from painting — axes and legends still draw, so charts look
  "empty" rather than broken, and nothing is logged. Charts set their own colors;
  see the comment in `web/src/components/charts/EChart.tsx`.
- `echarts-wordcloud` declares a stale `echarts@^5` peer. It runs fine on
  echarts 6 (all the legacy APIs it uses are still exported), so `package.json`
  carries an `overrides` entry. Do not "fix" it by pinning echarts back to 5.
- The app is behind a first-run legal consent gate
  (`web/src/components/common/ConsentGate.tsx`). Only `/error/*` bypasses it —
  any new route that must be reachable pre-consent has to join that list.
