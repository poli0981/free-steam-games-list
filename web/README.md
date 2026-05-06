# Web App — Steam F2P Tracker

Static web UI for browsing, analyzing, and (soon) editing the F2P games dataset that lives in this repo. Runs entirely in the browser, fetches `data/data_*.jsonl` directly from `raw.githubusercontent.com`, and deploys to GitHub Pages.

## Stack

- **Vite + React 18 + TypeScript**
- **Tailwind CSS** + shadcn/ui (Radix) primitives
- **TanStack Query** (data fetching) + **TanStack Table / Virtual** (1,200+ row table)
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
- **Phase 2** ✅ — PAT-based GitHub auth, single-record edit drawer for the 8 manual fields, diff viewer, single + bulk Steam-link queue, conflict-retry, toast notifications.
- **Phase 3** ✅ — **client-side OpenPGP signing** for verified commits, switched all writes from Contents API to the Git Data API (blob → tree → commit → ref), GPG settings panel with passphrase unlock, lock indicator in topbar, "will sign / unsigned" badge per commit. Earlier claim that PATs auto-sign was wrong — Contents API commits land as Unverified.
- **Phase 4** — bulk edit/delete, remaining 8 charts (heatmap, word cloud, stacked AC, histograms), PWA, i18n vi/en, command palette, activity feed, optional Tauri desktop wrap.

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
