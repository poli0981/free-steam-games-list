# Web App — Steam F2P Tracker

Static web UI for browsing, analyzing, and (soon) editing the F2P games dataset that lives in this repo. Runs entirely in the browser, fetches `data/data_*.jsonl` directly from `raw.githubusercontent.com`, and deploys to GitHub Pages.

## Stack

- **Vite + React 18 + TypeScript**
- **Tailwind CSS** + shadcn/ui (Radix) primitives
- **TanStack Query** (data fetching) + **TanStack Virtual** (1,200+ row table)
- **Apache ECharts** (treemap, donut, bar, etc.)
- **Zustand** (filter/UI state)
- **idb-keyval** (IndexedDB cache)
- **Fuse.js** (fuzzy search)

## Quick start

```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs to web/dist
npm run preview  # serve the production build
```

The app reads:

- `data/index.json` — shard manifest (`max_per_file`, `total`, `last_updated`, `files`)
- `data/data_001.jsonl`, `data/data_002.jsonl`, … — record shards

…all via `https://raw.githubusercontent.com/poli0981/free-steam-games-list/main/...`. No backend, no API key, no CORS proxy. The cache key is `index.last_updated` so the app revalidates only when shards actually change.

## Project layout

```
web/
├── src/
│   ├── lib/
│   │   ├── schema.ts          # MANUAL_FIELDS / ARRAY_FIELDS / EXTENSION_FIELDS / GameRecord
│   │   ├── data-store.ts      # extractAppid, normalizeLink, makeSkeleton, buildIndex
│   │   ├── fetcher.ts         # raw GitHub fetch + JSONL parse
│   │   ├── cache.ts           # IndexedDB read/write/freshness
│   │   ├── worker-pool.ts     # 1-worker JSONL parse proxy
│   │   ├── github-api.ts      # Contents API + workflow_dispatch (Phase 2)
│   │   └── utils.ts           # formatNumber, parseReviewPercent, cn
│   ├── workers/
│   │   └── jsonl-parser.ts    # Web Worker entry
│   ├── hooks/useGames.ts      # TanStack Query, returns { index, records, appidIndex }
│   ├── stores/filters.ts      # Zustand filter state
│   ├── components/
│   │   ├── ui/                # shadcn primitives (Button, Card, Dialog, Input, …)
│   │   ├── layout/            # Sidebar, Topbar, Layout
│   │   ├── charts/            # EChart wrapper + KpiCards + TopOnlineBar + GenreTreemap + PlatformsDonut
│   │   ├── games/             # GamesTable (virtualized) + GameDetailDrawer
│   │   └── common/            # Loading / Error / Placeholder
│   ├── pages/                 # Dashboard, Games, TopOnline, charts/*, Health, Add, Settings
│   ├── App.tsx                # HashRouter routes
│   ├── main.tsx               # Query client + router bootstrap
│   └── index.css              # Tailwind layers + theme tokens
├── public/                    # static assets (none yet)
├── index.html
├── package.json
├── vite.config.ts             # base = "/free-steam-games-list/" in build
├── tailwind.config.ts
├── tsconfig.json
└── tsconfig.node.json
```

## Roadmap

- **Phase 1** ✅ — read-only browse, search/filter, 4 MVP charts, GitHub Pages deploy.
- **Phase 2** ✅ — PAT-based GitHub auth, single-record edit drawer, diff viewer, single + bulk Steam-link queue, conflict-retry, toast notifications.
- **Phase 3** ✅ — client-side OpenPGP signing via Git Data API, GPG settings panel + passphrase unlock + lock indicator. Phase 3's signatures landed as Unverified because OpenPGP.js v6 attaches a `salt@notations.openpgpjs.org` notation by default; GitHub rejects it.
- **Phase 4** ✅ — GPG salt-notation fix, bulk edit + bulk delete (multi-shard single signed commit), 8 remaining charts, Health page with workflow triggers, ⌘K command palette.
- **Phase 4.1** ✅ — GPG signature payload fix: dropped trailing `\n` after the commit message so our signed bytes match `verification.payload` byte-for-byte. Verified via `gh api .../commits/{sha}.commit.verification.reason` → `valid`.
- **Phase 5** ✅ — **PWA** (installable, offline shell precache, stale-while-revalidate cache for raw JSONL data + Steam header images), **GPG identity override** (dropdown when key has multiple user IDs; commit author switches accordingly), **GPG auto-lock** (idle timer wipes the decrypted key after 5–60 min of inactivity), **Activity feed** at `/activity` (recent commits with verified badges, filter by Me / Bots / All).
- **Phase 6** ✅ — Genre/AC dropdowns (curated enums in `src/lib/enums.ts`), JSON editor toggle in EditGameDrawer, manual-field overrides on Add, GamesTable pagination + hidden scrollbar + per-row validation badge, CSV/JSON export, per-game permalinks `/games/:appid`, verify-after-commit poll, About page with dev info + 3rd-party stack, Topbar GPG quick-unlock popover, owner gate.
- **Phase 6.1** ✅ — Edit failing on shard 1 fix: Contents API caps `content` at 1 MB; new `getRepoFileText()` falls back to `/git/blobs/{sha}` for oversize files.
- **Phase 6.2** ✅ — stale-after-edit fix: bump `data/index.json.last_updated` in every shard-modifying commit, switched SW data cache from `StaleWhileRevalidate` → `NetworkFirst` (raw.github CDN is Fastly-cached for 5 min), and optimistic-update helpers (`optimisticEdit/Replace/BulkEdit/BulkDelete`) write straight to TanStack + IndexedDB so editors see their own change instantly without waiting for the CDN.
- **Phase 7** ✅ — date-column sort fix (`parseReleaseDate`), hamburger mobile nav (Sheet drawer, auto-close on route change), About expansion (Heads-up caveats + AI disclosure + legal links + per-third-party SPDX licence badges), legal docs rewritten (DISCLAIMER + EULA + ToS + PRIVACY) with the four caveats from `notes.txt`, refreshed `bug_report.yml`, workflow Node 20 → 24 + actions versions bumped.
- **Phase 8** ✅ — **i18n** (`react-i18next` with vi + en resource files, auto-detect from browser, switchable in Settings, sidebar/topbar/dashboard/settings/common UI translated, long-form legal copy stays English by design), **Tauri 2 desktop scaffold** under `src-tauri/` (fixed 1400 × 900 window, no resize, no maximise, dark theme, `tauri-plugin-shell` for Steam/GitHub external links), **release workflow** (`.github/workflows/release-desktop.yml`, matrix Win/Mac/Linux via `tauri-apps/tauri-action`, triggered by `desktop-v*` tags), version bumps (web app `1.0.0`, repo `3.0.0`), README + CHANGELOG + ACKNOWLEDGEMENTs refreshed.

## Desktop builds

```bash
cd web
npm run tauri:dev          # local dev with hot reload
npm run tauri:build        # release binary into src-tauri/target/release/bundle
```

Requires Rust toolchain locally (the GitHub release workflow installs it via `dtolnay/rust-toolchain@stable`). Window is fixed 1400 × 900 — see `src-tauri/tauri.conf.json` `app.windows[0]`.

To cut a release: tag `desktop-v1.0.0` and push. The matrix build creates a draft Release with `.msi` / `.dmg` / `.AppImage` / `.deb` assets attached. Edit and publish once you've smoke-tested the binaries.

## PWA

`vite-plugin-pwa` registers a Workbox service worker on every load. After the first visit the app shell loads from cache (offline-capable), and:

- `data/data_*.jsonl` from `raw.githubusercontent.com` is **NetworkFirst** with a 5-second timeout — online users always get the freshest shard, offline users fall back to the last-known cached copy. (The earlier `StaleWhileRevalidate` strategy required two reloads to see your own edits because of Fastly's 5-minute CDN cache; switched in Phase 6.2.)
- Steam header images (`shared.akamai.steamstatic.com/.../header.jpg`) are **cache-first** for 30 days.
- GitHub avatars are stale-while-revalidate for 7 days.

A small chip in the topbar shows **offline** / **Install** / **Update** when relevant. The browser's address-bar install button works too. On install the app launches as a standalone window.

## i18n

`react-i18next` + `i18next-browser-languagedetector` with two bundles in `src/i18n/locales/{en,vi}.json`. On first load the language is auto-detected from `navigator.language` (English fallback). Override anytime in **Settings → Language** — the choice persists in `localStorage` under `f2p:lang`.

Translations cover the high-traffic UI: sidebar nav, topbar, common buttons (Save / Cancel / Edit / Delete), dashboard, top-online, settings, edit drawer titles, common toasts. Long-form legal copy in `/about` and the static `docs/*.md` files stays in English on purpose — keeping the legal text byte-identical across languages avoids accidentally weakening the wording in translation.

## Auth + signing

Editing has two layers — both are configured under **Settings**:

1. **GitHub auth (required)** — Classic [PAT](https://github.com/settings/tokens/new?scopes=repo,workflow&description=F2P%20Tracker%20Web%20App) with `repo` + `workflow` scopes. Verified against `/user` and stored in `localStorage`. Used to authenticate every Git Data API call.
2. **GPG signing (optional but recommended)** — paste your armored OpenPGP private key. The encrypted block stays in `localStorage`; you unlock it once per session with your passphrase. The decrypted key lives in memory only and is wiped on lock or tab close. Each edit/add commit gets a detached binary signature and is sent to `POST /git/commits` with a `signature` field — GitHub then marks the commit **Verified** (provided the key's user-ID email is registered on your account).

Without an unlocked GPG key, edits and adds still land — but appear as Unverified on GitHub. The Add and Edit drawers show a `signed`/`unsigned` badge so you always know which path you're on.

## Architecture: how a write happens

Read-side and write-side are deliberately split:

- **Read** — Contents API (`GET /repos/.../contents/{path}`) returns base64 + sha in one round trip. Cheap, used to fetch the latest shard or `temp_info.jsonl` content right before mutation. The sha is informational only; no write happens here.
- **Write** — Git Data API. `commitFile(...)` orchestrates: `getHead` → `createBlob` (base64 of new content) → `createTree` (rebased on head's tree) → if a `signer` is provided, build the exact commit-object bytes and sign them OpenPGP-detached → `createCommit` (with optional `signature`) → `updateRef` (fast-forward, no force). On 422 ("ref advanced") the helper retries once.

The signed commit-object bytes match Git's wire format exactly — `tree HEX\nparent HEX\nauthor NAME <EMAIL> UNIX_TS +0000\ncommitter ...\n\nMESSAGE\n` — so GitHub recomputes them server-side and the signature verifies.

## Schema sync

`MANUAL_FIELDS`, `ARRAY_FIELDS`, `EXTENSION_FIELDS`, and `SKIP_GENRE_TAGS` live in [`src/lib/schema.ts`](src/lib/schema.ts) and must mirror [`scripts/core/constants.py`](../scripts/core/constants.py). When the Python source changes, update both.

## Deployment

`/.github/workflows/deploy-pages.yml` runs on push to `main` (only when `web/**` or `data/**` change), builds `web/dist`, and deploys to GitHub Pages. After enabling Pages in repo settings (Source: GitHub Actions), the site lives at:

> https://poli0981.github.io/free-steam-games-list/

## Contributing

This app sits inside a Python-pipeline repo. The 9 existing workflows (update-json, update-daily, top-online, …) only run on cron or `workflow_dispatch`, so there is no collision. Do **not** reimplement `scripts/generate_tables.py` in JS — Phase 2 will trigger it via `workflow_dispatch` instead.
