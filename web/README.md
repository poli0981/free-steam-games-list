# Web App — Steam F2P Tracker

The public site at <https://free-steam-games.win/>, the Cloudflare Worker
behind it, and the Tauri desktop/Android shells — all from this one directory.

It is **read-only for visitors.** Sign-in, in-browser editing and client-side
GPG signing were removed in September 2026; the only write path left is
`/admin`, a separate Svelte app (`admin/`) that is embedded in the Worker and
served only behind Cloudflare Access. See [docs/ADMIN.md](../docs/ADMIN.md).

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

The browser contacts two third parties, both only after the reader accepts the
terms and neither in the packaged apps: the Cloudflare Web Analytics beacon,
and Cloudflare Turnstile for the once-a-day human check (`src/lib/human-check.ts`,
[docs/SECURITY_SETUP.md](../docs/SECURITY_SETUP.md) section 12). Everything else
is same-origin, through the Worker.

## Quick start

```bash
cd web
npm install
npm run dev      # http://localhost:5173 — proxies /api and /img to production
npm run build    # -> web/dist
```

`npm run dev` serves only the app. It does **not** run `worker/`; `/api/*` and
`/img/*` are proxied to the deployed site so you get real data and real images.
The human check is switched off there, because production would refuse a
localhost token (`npm run preview` proxies the same way and cannot pass it).
To exercise Worker code, run the Worker and the built assets together:

```bash
cp .dev.vars.example .dev.vars   # once: Cloudflare's always-pass Turnstile test secret
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
- `/api/human-check` — `POST` only, same-origin only: verifies the Turnstile
  token with the `TURNSTILE_SECRET` secret. It answers yes or no and grants
  nothing else; no route above requires a pass (`docs/ToS.md` §9)

`index.json` lists a SHA-256 for every shard. The app requests shards as
`?v=<sha256>`, which the Worker serves content-addressed and immutable (or 503s
while GitHub's CDN still has the previous bytes), and hashes what it receives
before caching it. IndexedDB holds the last generation that verified; the app
re-checks the index when the tab regains focus and every ten minutes while it is
visible, and falls back to that cache offline.

## Layout

```
web/
├── src/
│   ├── routes/                 # pages; +layout, +error, sitemap.xml
│   ├── params/                 # route param matchers (legal document slugs)
│   ├── lib/
│   │   ├── *.svelte.ts         # rune state: games, filters, prefs, i18n, pwa
│   │   ├── schema.ts           # mirrors scripts/core/constants.py
│   │   ├── games-loader.ts     # verified shard generations, offline fallback
│   │   ├── cache.ts            # IndexedDB read/write
│   │   ├── fallback-route.ts   # re-renders routes served the SPA shell
│   │   ├── consent.svelte.ts   # legal consent, hashed per document
│   │   ├── diff.ts             # the line diff the consent gate shows
│   │   ├── analytics.ts        # the beacon, appended only after consent
│   │   ├── human-check.ts      # the Turnstile check's rules (+ -state.svelte.ts, turnstile.ts)
│   │   ├── gates.ts            # the routes no first-run gate covers
│   │   ├── charts/             # EChart wrapper, registration, ChartPage
│   │   ├── common/             # Seo, ConsentGate, HumanCheck, QueryState, ErrorView, …
│   │   ├── games/              # virtualised table, columns, filtering
│   │   ├── server/markdown.ts  # /legal/* rendering, BUILD TIME ONLY
│   │   └── ui/                 # Button, Badge, Input (also used by admin/)
│   ├── styles/theme.css        # design tokens, shared with admin/
│   ├── workers/jsonl-parser.ts # Web Worker
│   ├── i18n/locales/{en,vi}.json
│   ├── app.html
│   └── index.css
├── admin/                      # the /admin app: own Vite build, embedded in the Worker
├── worker/                     # the Cloudflare Worker (routes, lib, migrations)
├── shared/                     # queue rules, API types, the human check's constants
├── build/game-seeds.ts         # build-time seeds for the prerendered game pages
├── build/legal-versions.ts     # content hashes + sources for the legal documents
├── src-tauri/                  # desktop + Android shell
├── static/                     # _headers, robots.txt, security.txt, generated art
├── scripts/verify-dist.mjs     # checks the built output (run in CI)
├── scripts/gen-fontface.py     # subsetted @font-face rules
├── scripts/gen-icons.py        # icons + og.png, from static/icon.svg
├── svelte.config.js            # adapter, CSP, prerender entries
└── wrangler.jsonc              # Worker + static-asset config
```

`src/static/` art is generated — `icon.svg` is the only mark you edit by hand.

## Rendering

Every route is prerendered, including one page per game on the web build: the
`gameSeeds` Vite plugin (`build/game-seeds.ts`) reads `../data` at build time,
and each page carries the slow-changing fields as a `#game-seed` block that
the same universal load reads back while hydrating. Player counts and reviews
are never seeded; they come from the live catalogue. The Tauri build
prerenders no game pages, and `/developers/[name]` and `/publishers/[name]` are
never prerendered: those are served the app shell and rendered from the
catalogue.

Two things about that are load-bearing and easy to break — both are explained
at length in `svelte.config.js` and `src/lib/fallback-route.ts`:

- `kit.paths.relative` is **false**. The default (`true`) gives prerendered
  pages relative asset URLs, which resolve against the wrong directory the
  moment a page is served as the fallback.
- Both hosts answer an unmatched path with `index.html` — the prerendered
  dashboard — and a prerendered page hydrates as its own route.
  `fallback-route.ts` corrects that on first mount for the routes that can
  fall back, and an unmatched URL renders the 404 in place.

## Content-Security-Policy

Owned by `kit.csp` in `svelte.config.js` and emitted as a `<meta>` tag with the
sha256 of SvelteKit's inline bootstrap. It is deliberately **not** in
`static/_headers`: browsers enforce the intersection of header and meta
policies, so a `script-src 'self'` header blocks that script whatever the meta
says, and the app renders but never hydrates.

The policy has two flavours, selected by `TAURI_ENV_PLATFORM`. Under Tauri the
origin is `tauri://localhost` (or `http://tauri.localhost` on Windows and
Android), so `'self'` is the bundle rather than the site and the packaged apps
need the site's origin named explicitly. The web flavour alone names
`static.cloudflareinsights.com` in `script-src` and `cloudflareinsights.com` in
`connect-src`, for the analytics beacon (`lib/analytics.ts`), and
`challenges.cloudflare.com` in `script-src` and `frame-src`, for the Turnstile
human check (`lib/turnstile.ts`); `verify-dist.mjs` fails the web build without
them and the Tauri build with any of them.

Cloudflare's **automatic** Web Analytics injection can never be used here: it
adds an inline loader at the edge, after this response, and CSP3 makes a
`script-src` carrying a hash ignore `'unsafe-inline'`. The dashboard must stay
on "Enable with JS Snippet installation".

`frame-ancestors` is ignored in a meta CSP, so `X-Frame-Options: DENY` in
`static/_headers` is what stops framing.

## PWA

`@vite-pwa/sveltekit` builds a Workbox service worker, registered only after
the legal consent step and the human check, and never in the Tauri build (a
worker at `tauri.localhost` can never update).

- Updates prompt ("Update available" → Reload) rather than swapping the app
  under an open page, and the worker checks for a new version hourly.
- `/api/data/*` is **not** cached by the worker. IndexedDB is the offline
  store, and only for a generation whose hashes verified.
- `/img/*` is **CacheFirst** for 30 days, status 200 only. Steam's `?t=` is an
  asset mtime, so a changed image arrives as a different URL.
- The prerendered game pages are left out of the precache (they would add
  about 120 MB).
- `navigateFallback` is `/`, not `/200.html`. `adapter-static` writes the
  fallback after Workbox has globbed the build output, so `/200.html` could
  never be a precache entry and `createHandlerBoundToURL()` threw on every
  load. `/` is both precached and what Cloudflare and Tauri already serve for
  an unmatched path, so `lib/fallback-route.ts` recovers the route offline
  exactly as it does online. `verify-dist.mjs` checks the two agree.
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

`src/lib/i18n.test.ts` scans the source and fails on a key that does not
exist, a placeholder a call site does not fill, a template-literal key, an
English key nothing uses any more, and a Vietnamese value that is just the
English copied across (names and formats are allowlisted there).

## Legal consent, and showing what changed

`lib/common/ConsentGate.svelte` is an overlay, not a replacement for the page —
`onMount` does not run during prerender, so gating the markup behind it would
ship an empty body. Only `/error/*` and `/legal/*` are exempt (`lib/gates.ts`,
shared with the human check): the gate links to the documents it asks people
to accept.

Each binding document is hashed at build time. `build/legal-versions.ts` serves
two virtual modules:

- `virtual:legal-versions` — a hash per document slug. Tiny, imported
  statically, so the gate can decide whether anything changed without a fetch.
- `virtual:legal-sources` — the raw markdown, ~25 KB. Imported **dynamically**,
  by the gate alone, so a page load that never opens it never downloads it.

When a hash differs from the one stored at acceptance, the gate reopens by
itself and lists **only those documents**, each as a line diff (`lib/diff.ts`)
against the copy in `f2p:legal_snapshot` — rendered as text in a `<pre>`, never
`{@html}`. With no snapshot (storage cleared, or an acceptance predating the
feature) it links to the full document instead.

`TERMS_VERSION` in `lib/consent.svelte.ts` survives only as the "make everyone
re-read all six" override; an ordinary edit no longer needs anyone to remember
it. Consent lives in its own module rather than `lib/prefs.svelte.ts` because
the admin SPA compiles that file with its own Vite config, which cannot resolve
a virtual module.

## The human check

After consent, `lib/common/HumanCheck.svelte` — the same kind of overlay —
asks each browser to pass Cloudflare Turnstile at most once every 24 hours,
and the Worker verifies the token at `/api/human-check`. It is web only, off
under `npm run dev`, and soft by design: it keeps automated browsers from
using the app, but nothing on the server requires a pass, because the pages
are static and `docs/ToS.md` §9 keeps `/api/data/*` and `/img/*` open. It
refuses only on a verdict from Cloudflare and lets the reader through, for that
page load, whenever the fault is the site's or the reader is offline.
`lib/human-check.ts` has the rules and their reasons;
[docs/SECURITY_SETUP.md](../docs/SECURITY_SETUP.md) section 12 has the widget
settings, the secret and the local test keys.

## Analytics

`lib/analytics.ts` appends the Cloudflare Web Analytics beacon from the same
`$effect` that gates the catalogue fetch and the service worker on
`consent.accepted` and the human check, so nothing reaches a third party before
the reader accepts. It returns early under `isTauri()` and when
`CF_BEACON_TOKEN` is empty, which is what a fork gets.

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
npm run typecheck  # builds admin/, then svelte-check (app + admin) and tsc (Worker, tests)
npm test           # vitest
npm run knip       # dead code and dependencies
npm run build      # site, then admin/
node scripts/verify-dist.mjs --web
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.jsonc
```
