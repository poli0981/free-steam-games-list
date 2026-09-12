# Web App — Steam F2P Tracker

The public site at <https://free-steam-games.win/>, the Cloudflare Worker
behind it, and the Tauri desktop/Android shells — all from this one directory.

It is **read-only for visitors.** Sign-in, in-browser editing and client-side
GPG signing were removed in September 2026; the only write path left is
`/admin`, which is server-rendered by the Worker and gated by Cloudflare
Access.

## Stack

- **SvelteKit 2 + Svelte 5** (runes), prerendered to static HTML by
  `@sveltejs/adapter-static`
- **Vite 8** (Rolldown) + **TypeScript**
- **Tailwind CSS 4** — as a Vite plugin; there is no `tailwind.config.ts` and
  no PostCSS config
- **Bits UI** primitives, **@lucide/svelte** icons, **svelte-sonner** toasts
- **Apache ECharts 6** (`echarts/core` + an explicit `use()` list) and
  `echarts-wordcloud`
- **@tanstack/svelte-virtual** for the 3,600-row table
- **Fuse.js** (fuzzy search), **idb-keyval** (IndexedDB cache)
- **unified / remark / rehype** — build time only, for `/legal/*`
- Three self-hosted variable typefaces: Bricolage Grotesque, IBM Plex Sans,
  JetBrains Mono

State is plain Svelte 5 runes in `.svelte.ts` modules. There is no store
library and no data-fetching library.

## Quick start

```bash
cd web
npm install
npm run dev      # http://localhost:5173 — proxies /api and /img to production
npm run build    # -> web/dist
```

`npm run dev` serves only the app. It does **not** run `worker/`; `/api/*` and
`/img/*` are proxied to the deployed site so you get real data and real images.
To exercise Worker code, run the Worker and the built assets together:

```bash
node node_modules/wrangler/bin/wrangler.js dev --config wrangler.jsonc
```

## Where the data comes from

The browser never talks to GitHub. Everything is same-origin through the
Worker:

- `/api/data/data/index.json` — shard manifest (`max_per_file`, `total`,
  `last_updated`, `files`)
- `/api/data/data/data_001.jsonl`, … — record shards
- `/img/t/<appid>/...` — Steam artwork, proxied and edge-cached
- `/img/gh/{u|in}/{id}` — GitHub avatars for `/activity`
- `/api/activity` — recent commits, so `api.github.com` is absent from the
  site's `connect-src`

The IndexedDB cache is keyed on `index.last_updated`, so the app revalidates
only when shards actually change.

## Layout

```
web/
├── src/
│   ├── routes/                 # 30 routes; +layout, +error, sitemap.xml
│   ├── lib/
│   │   ├── *.svelte.ts         # rune state: games, filters, prefs, i18n
│   │   ├── schema.ts           # mirrors scripts/core/constants.py
│   │   ├── fetcher.ts          # shard fetch + JSONL parse
│   │   ├── cache.ts            # IndexedDB read/write/freshness
│   │   ├── fallback-route.ts   # re-renders routes served the SPA shell
│   │   ├── charts/             # EChart wrapper, registration, ChartPage
│   │   ├── common/             # Seo, ConsentGate, QueryState, ErrorView, …
│   │   ├── games/              # virtualised table, columns, filtering
│   │   ├── server/markdown.ts  # /legal/* rendering, BUILD TIME ONLY
│   │   └── ui/                 # Button, Badge, Input, Dialog, …
│   ├── workers/jsonl-parser.ts # Web Worker
│   ├── i18n/locales/{en,vi}.json
│   ├── app.html
│   └── index.css               # theme tokens + @theme inline
├── worker/                     # the Cloudflare Worker (routes, lib, migrations)
├── src-tauri/                  # desktop + Android shell
├── static/                     # _headers, robots.txt, security.txt, generated art
├── scripts/gen-fontface.py     # subsetted @font-face rules
├── scripts/gen-icons.py        # icons + og.png, from static/icon.svg
├── svelte.config.js            # adapter, CSP, prerender entries
└── wrangler.jsonc              # Worker + static-asset config
```

`src/static/` art is generated — `icon.svg` is the only mark you edit by hand.

## Rendering

Every route is prerendered except three: `/games/[appid]`,
`/developers/[name]` and `/publishers/[name]`, each of which would be several
thousand near-identical pages. Those are served the app shell and rendered from
the catalogue the client already holds.

Two things about that are load-bearing and easy to break — both are explained
at length in `svelte.config.js` and `src/lib/fallback-route.ts`:

- `kit.paths.relative` is **false**. The default (`true`) gives prerendered
  pages relative asset URLs, which resolve against the wrong directory the
  moment a page is served as the fallback.
- Both hosts answer an unmatched path with `index.html` — the prerendered
  dashboard — and a prerendered page hydrates as its own route.
  `fallback-route.ts` corrects that on first mount.

## Content-Security-Policy

Owned by `kit.csp` in `svelte.config.js` and emitted as a `<meta>` tag with the
sha256 of SvelteKit's inline bootstrap. It is deliberately **not** in
`static/_headers`: browsers enforce the intersection of header and meta
policies, so a `script-src 'self'` header blocks that script whatever the meta
says, and the app renders but never hydrates.

The policy has two flavours, selected by `TAURI_ENV_PLATFORM`. Under Tauri the
origin is `tauri://localhost`, so `'self'` is the bundle rather than the site
and the packaged apps need the site's origin named explicitly.

`frame-ancestors` is ignored in a meta CSP, so `X-Frame-Options: DENY` in
`static/_headers` is what stops framing.

## PWA

`@vite-pwa/sveltekit` registers a Workbox service worker.

- `/api/data/*` is **NetworkFirst** with a 5-second timeout. It must not be
  cache-first: `index.json` carries `last_updated`, the client's only
  cache-invalidation signal, so serving that from cache strands every reader on
  stale records.
- `/img/*` is **CacheFirst** for 30 days, status 200 only. Steam's `?t=` is an
  asset mtime, so a changed image arrives as a different URL.
- `/api/*`, `/img/*` and `/admin` are on the navigation-fallback denylist. An
  installed worker answering `/admin` from the app shell would serve the public
  shell where the Access gate belongs.

## i18n

Two bundles in `src/i18n/locales/{en,vi}.json`, loaded by `src/lib/i18n.svelte.ts`.
English is statically bundled as the fallback so prerendered HTML contains real
strings; a Vietnamese visitor's bundle swaps in on hydration. The choice
persists in `localStorage` under `f2p:lang`.

Long-form legal copy stays English on purpose — keeping the wording
byte-identical across languages avoids weakening it in translation.

`src/lib/i18n.test.ts` scans the source for literal `t("…")` keys and fails on
any that do not exist in both locales. It was written after three invented keys
shipped.

## Desktop and Android

```bash
npm run tauri:dev
npm run tauri:build            # -> src-tauri/target/release/bundle
npm run tauri:android:build    # -> APK
```

Needs a Rust toolchain locally; the release workflows install one. The window
is 1280×860, resizable, minimum 880×600 — it was pinned to a fixed 1400×900
until 2.0.0.

The packaged apps use real paths, not hash routes:
`tauri::manager::get_asset()` resolves `/games/730` through its own fallback
chain. Hash URLs from released 1.4.x builds are still upgraded on load by
`upgradeLegacyHashUrl()`.

To cut a release, push a `desktop-v*` or `android-v*` tag. Both workflows
publish a **draft** release — smoke-test the binaries before publishing.

## Schema sync

`MANUAL_FIELDS`, `ARRAY_FIELDS`, `EXTENSION_FIELDS` and the record shape in
[`src/lib/schema.ts`](src/lib/schema.ts) mirror
[`scripts/core/constants.py`](../scripts/core/constants.py). Change one, change
the other.

## Deployment

Pushing to `main` triggers Cloudflare Workers Builds, which runs the build and
deploys the Worker together with `dist/` as static assets. The reliable signal
is the `Workers Builds: free-steam-games-list` check run — `wrangler
deployments list` lags several minutes behind reality.

`.github/workflows/deploy-pages.yml` no longer deploys anything; GitHub Pages
serves a client-side redirect to the new domain while old inbound links drain.

See [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) and
[docs/ADMIN.md](../docs/ADMIN.md).

## Checks

```bash
npm run check      # svelte-check
npm test           # vitest
npm run knip       # dead code and dependencies
npm run build
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.jsonc
```
