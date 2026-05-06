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

- **Phase 1** ✅ — read-only browse, search/filter, 4 MVP charts (KPI, Top Online bar, Genre treemap, Platforms donut), GitHub Pages deploy.
- **Phase 2** ✅ — PAT-based GitHub auth (Classic PATs auto-sign as "Verified"), single-record edit drawer for the 8 manual fields, diff viewer, single + bulk Steam-link queue via `scripts/temp_info.jsonl`, conflict-retry on PUT, toast notifications.
- **Phase 3** — bulk edit/delete, remaining 8 charts (heatmap, word cloud, stacked AC, histograms), PWA, i18n vi/en, command palette, activity feed, optional Tauri desktop wrap. Optional: OAuth Device Flow path (requires registering a GitHub OAuth App for the CLIENT_ID).

## Auth & editing

Editing requires a GitHub personal access token. Sign in via **Settings → Sign in**:

1. Create a [Classic PAT](https://github.com/settings/tokens/new?scopes=repo,workflow&description=F2P%20Tracker%20Web%20App) with scopes `repo` + `workflow`.
2. Paste it into the sign-in form. The token is verified against `/user` and the repo's permissions, then stored in `localStorage`.
3. Edits commit to `data/data_00X.jsonl` shards. Adds queue into `scripts/temp_info.jsonl`, which auto-triggers the existing `ingest-new.yml` workflow to fetch full Steam metadata.

Classic PATs produce GitHub-signed "Verified" commits (because GitHub web-flow signs server-side). Fine-grained PATs work too, but commits won't have the Verified badge.

## Schema sync

`MANUAL_FIELDS`, `ARRAY_FIELDS`, `EXTENSION_FIELDS`, and `SKIP_GENRE_TAGS` live in [`src/lib/schema.ts`](src/lib/schema.ts) and must mirror [`scripts/core/constants.py`](../scripts/core/constants.py). When the Python source changes, update both.

## Deployment

`/.github/workflows/deploy-pages.yml` runs on push to `main` (only when `web/**` or `data/**` change), builds `web/dist`, and deploys to GitHub Pages. After enabling Pages in repo settings (Source: GitHub Actions), the site lives at:

> https://poli0981.github.io/free-steam-games-list/

## Contributing

This app sits inside a Python-pipeline repo. The 9 existing workflows (update-json, update-daily, top-online, …) only run on cron or `workflow_dispatch`, so there is no collision. Do **not** reimplement `scripts/generate_tables.py` in JS — Phase 2 will trigger it via `workflow_dispatch` instead.
