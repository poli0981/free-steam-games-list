I verified every claim against the actual files. Here is the design.

---

# Cloudflare platform migration — implementable design

## 0. Corrections and additions to the brief (verified)

| Brief said | Verified reality | Evidence |
|---|---|---|
| "domain does NOT resolve — treat DNS setup as a step to verify" | The **zone is already live on Cloudflare**. `NS` = `charles.ns.cloudflare.com`, `desi.ns.cloudflare.com`; `SOA` answers authoritatively. Apex returns **NOERROR/NODATA** (name exists, no A/AAAA). `www` is **NXDOMAIN**. So: nameservers are done; only records are missing. | `nslookup -type=NS/SOA/A free-steam-games.win 1.1.1.1` |
| images.weserv covers thumbnails | `preferWebp()` is used in **exactly one** place (`web/src/components/games/GameDetailDrawer.tsx:109`). `headerToCapsule()` is used in three (`table/columns.tsx:35`, `table/MobileGameCards.tsx:94`, `common/CommandPalette.tsx:211` — the brief missed CommandPalette). | grep |
| Steam images come from `shared.akamai.steamstatic.com` | **Two** hosts. 1,927 records on `shared.akamai.steamstatic.com`, **1,496 on `shared.fastly.steamstatic.com`** (44%). The `steam-headers` runtimeCaching rule in `web/vite.config.ts:100-102` only matches `akamai` — **44% of thumbnails are not service-worker cached today.** | `grep -o '"header_image": *"https://shared\.\(akamai\|fastly\)' data/*.jsonl \| wc -l` |
| — | **214 records** have a header filename that is not `header.jpg` (e.g. `header_alt_assets_19.jpg`). `headerToCapsule()` (`web/src/lib/image.ts:11-14`) tests `url.includes("header.jpg")`, so for those 214 the table loads the full ~50 KB header instead of the 10 KB capsule. | grep |
| — | **`npm run build:desktop` / `build:mobile` are already half-broken.** They pass `--base /` (`web/package.json:9-10`), which overrides `base`, but `manifest.scope`, `manifest.start_url` and `workbox.navigateFallback` are computed from `command === "build"` (`web/vite.config.ts:44-45, 76`) and stay `/free-steam-games-list/`. Confirmed in the committed build output: `web/dist/manifest.webmanifest` has `"start_url":"/free-steam-games-list/"` while `web/dist/index.html` uses root-absolute asset paths. The `base: "/"` change in §3 fixes this as a side effect. | `cat web/dist/manifest.webmanifest` |
| "dozens of docs" reference the Pages URL | **25 occurrences across 15 tracked files** (the 292-hit count includes `.claude/worktrees/`). Full list in §6.3. | `git grep -c poli0981.github.io` |
| — | Deleting `deploy-pages.yml` orphans **`.github/workflows/notify-deploy.yml`**, which triggers on `workflow_run: workflows: ["Deploy Web (GitHub Pages)"]` (`notify-deploy.yml:7`). It will silently never fire again. | file read |
| — | Root `.gitignore` has no `.wrangler/` entry. `wrangler dev` writes `.wrangler/state/**` (including `*.sqlite` D1 local state — `*.sqlite` *is* ignored at line ~"Database", but the rest of `.wrangler/` is not). | `cat .gitignore` |

---

## 1. `wrangler.jsonc` — exact content and location

### 1.1 Where the file must live

Workers Builds' **root directory** is where the build command runs *and* where Wrangler looks for its config. The build must run in `web/` (that is where `package.json`, `package-lock.json`, `vite.config.ts` and `tsconfig.json` live, and Workers Builds auto-detects the package manager from the lockfile in the root directory — there is no root `package.json`).

**Therefore:**

```
web/wrangler.jsonc          <- the file
web/worker/index.ts         <- "main", relative to wrangler.jsonc
web/dist/                   <- "assets.directory", relative to wrangler.jsonc
```

Workers Builds root directory = **`web`**. Do **not** put `wrangler.jsonc` at the repo root; that would force `"main": "./web/worker/index.ts"`, `"directory": "./web/dist"`, a `cd web &&` build command, and would break dependency auto-install.

### 1.2 The file

```jsonc
// web/wrangler.jsonc
//
// The ONLY deployment config for this project. Cloudflare Workers Builds
// (dashboard → Worker → Settings → Build) is pointed at this repo with
// root directory "web"; a push to main triggers build + deploy. There is
// deliberately no deploy workflow in .github/workflows.
{
  "$schema": "node_modules/wrangler/config-schema.json",

  // Worker name. Also the *.workers.dev subdomain (f2p-tracker.<sub>.workers.dev),
  // which stays enabled as the rollback/preview target — see §6.
  "name": "f2p-tracker",

  // Worker entry module, relative to this file. See §2 for the layout.
  "main": "./worker/index.ts",

  // Pin runtime semantics. Bump deliberately, never "just because".
  // Any date >= 2024-09-19 supports static assets; today's date is fine.
  "compatibility_date": "2026-09-10",

  // Empty on purpose. Add "nodejs_compat" ONLY if server-side code ever needs
  // node:buffer / node:crypto — today the Worker uses fetch + Web Crypto +
  // D1 only, and an empty flag list keeps cold starts minimal.
  // Do NOT add "global_fetch_strictly_public" unless the Worker starts
  // fetching its own hostname (it does not; it fetches GitHub + Steam CDNs).
  "compatibility_flags": [],

  "assets": {
    // Vite's outDir. web/.gitignore:2 and the root .gitignore both ignore
    // `dist`, so this directory only exists inside the build container.
    "directory": "./dist",

    // Lets worker/index.ts fall through to the static-asset server:
    //   return env.ASSETS.fetch(request)
    "binding": "ASSETS",

    // Vite emits extensionless routes only via the client router, so keep
    // the default "auto-trailing-slash". Stated explicitly so a future
    // reader knows it was a decision, not an omission.
    "html_handling": "auto-trailing-slash",

    // THE SPA SWITCH. Any request that matches no file returns dist/index.html
    // with HTTP 200, which is what BrowserRouter needs (§4). This replaces
    // GitHub Pages' 404.html hack entirely — delete web/public/404.html.
    "not_found_handling": "single-page-application",

    // Array form (not `true`): the Worker script runs ONLY for these prefixes.
    // Everything else — /, /games/123, /assets/*.js — is served straight from
    // the asset server, which is free and unbilled, and never invokes the
    // Worker at all.
    //
    // CONSEQUENCE, easy to get wrong: because "/" is not in this list, the
    // Worker CANNOT implement the www -> apex redirect. That is handled by a
    // zone Redirect Rule instead (§5.4).
    //
    // Using the array form also disables Cloudflare's automatic
    // `Sec-Fetch-Mode: navigate` heuristic, which is what we want: explicit
    // routing, no surprises.
    "run_worker_first": ["/api/*", "/img/*"]
  },

  // Workers Logs. head_sampling_rate 1 while migrating; drop to 0.1 once the
  // traffic shape is known. Only Worker invocations are logged (i.e. /api/*
  // and /img/*), so volume stays low.
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },

  // Admin-only state: the daily "new games" queue, edit drafts, audit log.
  // data/*.jsonl in Git remains canonical (see repo docs); D1 never holds
  // game records, only workflow state.
  // database_id comes from `npx wrangler d1 create f2p-admin` — it is an
  // account-scoped UUID, not a secret, and is safe to commit.
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "f2p-admin",
      "database_id": "<uuid-from-wrangler-d1-create>",
      "migrations_dir": "./worker/migrations"
    }
  ],

  // Non-secret build/runtime config. Secrets (GITHUB_APP_PRIVATE_KEY,
  // GH_COMMIT_TOKEN, ...) go through `wrangler secret put` or the dashboard
  // and must NEVER appear here.
  "vars": {
    "SITE_ORIGIN": "https://free-steam-games.win",
    "REPO_OWNER": "poli0981",
    "REPO_NAME": "free-steam-games-list",
    "REPO_BRANCH": "main",

    // Kill-switch for Cloudflare Image Transformations. false = /img/* is a
    // pure allowlisted passthrough proxy and costs ZERO transformations.
    // Flip to "true" only after reading the cost note in §2.4.
    "IMG_TRANSFORM": "false",

    // Edge cache TTLs (seconds) for the data proxy. index.json is the
    // cache-invalidation signal for the whole app, so it is deliberately short.
    "DATA_INDEX_TTL": "60",
    "DATA_SHARD_TTL": "300"
  },

  // Apex only. www is a DNS placeholder + Redirect Rule (§5.4) so that a
  // www hit costs zero Worker invocations. Declaring a custom_domain here
  // makes Cloudflare create and maintain the proxied DNS record and the
  // edge certificate automatically.
  "routes": [
    { "pattern": "free-steam-games.win", "custom_domain": true }
  ]
}
```

**If you would rather keep www in the repo instead of the dashboard**, add a second `{ "pattern": "www.free-steam-games.win", "custom_domain": true }` **and** change `run_worker_first` to `true` — the redirect cannot work otherwise. That makes every asset request a billed Worker request. I do not recommend it; §5.4's Redirect Rule is free and runs earlier.

### 1.3 Also needed alongside it

- `web/public/_headers` — Vite copies `public/` into `dist/`; Cloudflare consumes `_headers` and does not serve it as an asset. Static-asset default is `Cache-Control: public, max-age=0, must-revalidate`, which is wrong for Vite's fingerprinted `/assets/*`. Note the documented limitation: **`_headers` does not apply to Worker-generated responses**, so `/api/*` and `/img/*` must set headers in code.

  ```
  /*
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin
    Cross-Origin-Opener-Policy: same-origin
    Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), interest-cohort=()
    Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://shared.akamai.steamstatic.com https://shared.fastly.steamstatic.com https://avatars.githubusercontent.com; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://github.com; font-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'

  /assets/*
    Cache-Control: public, max-age=31536000, immutable

  /index.html
    Cache-Control: public, max-age=0, must-revalidate
  /sw.js
    Cache-Control: public, max-age=0, must-revalidate
  /manifest.webmanifest
    Cache-Control: public, max-age=0, must-revalidate
  ```

  Two CSP consequences you must handle or the site breaks: `injectRegister: "auto"` in `web/vite.config.ts:32` emits an **inline** registration script — change it to `"script-defer"` so it becomes an external file. And the hash-redirect shim (§6.1) must likewise be an external `/hash-shim.js`, not inline. `style-src 'unsafe-inline'` is unavoidable: Radix, sonner and ECharts all set style *attributes*.

  **Flag (unverified):** I could not confirm whether the SPA fallback response for `/games/123` picks up the `/*` rule or the `/index.html` rule. Keeping the security headers in `/*` makes it correct either way; that is why they are there and not on `/index.html`.

- `web/public/_redirects` — optional, for the handful of legacy path shapes. **It cannot help with `#/` URLs**: Cloudflare's docs are explicit that "fragments in the source are not evaluated" because the browser never sends them. Hence §6.1's JS shim.

- `.gitignore` needs a `.wrangler/` entry (currently absent).

- `web/tsconfig.json` `include` is `["src", "vite.config.ts"]`, so `worker/` is not type-checked. Add `web/worker/tsconfig.json` (its own project, `"types": ["./worker-configuration.d.ts"]` generated by `npx wrangler types`) and reference it from `tsc -b`. Without this the Worker ships untyped and `npm run typecheck` silently ignores it.

---

## 2. Worker entry module layout

```
web/worker/
  index.ts                 # default export { fetch }  <- wrangler "main"
  router.ts                # 30-line path matcher, no dependency
  env.d.ts                 # Env interface (ASSETS, DB, vars, secrets)
  worker-configuration.d.ts# generated: npx wrangler types
  lib/
    respond.ts             # json(), problem(), withSecurityHeaders()
    cache.ts               # edge-cache get/put/purge via caches.default
    github.ts              # Git Data API client (blob→tree→commit→update-ref)
    identity.ts            # Cloudflare Access JWT verify -> { email, sub }
    validate.ts            # allowlists: image hosts, widths, shard names
  routes/
    data.ts                # GET /api/data/*
    img.ts                 # GET /img/*
    health.ts              # GET /api/health
    admin/
      queue.ts             # GET/POST /api/admin/queue
      drafts.ts            # CRUD /api/admin/drafts
      audit.ts             # GET /api/admin/audit
      commit.ts            # POST /api/admin/commit -> Git
  migrations/
    0001_init.sql          # queue, drafts, audit tables
```

### 2.1 `index.ts` skeleton

```ts
import { Router } from "./router";
import { withSecurityHeaders, problem } from "./lib/respond";
import * as data from "./routes/data";
import * as img from "./routes/img";
import * as health from "./routes/health";
import * as admin from "./routes/admin";

const router = new Router()
  .get("/api/health",              health.handle)
  .get("/api/data/index.json",     data.handleIndex)
  .get("/api/data/:shard",         data.handleShard)   // shard must match /^data_\d{3}\.jsonl$/
  .get("/img/:width/:host/*",      img.handle)
  .all("/api/admin/*",             admin.handle);      // Access-gated, see §2.5

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // run_worker_first is ["/api/*","/img/*"], so in production this handler
    // only ever sees those two prefixes. The ASSETS fallthrough below exists
    // for `wrangler dev` (where run_worker_first is easy to misconfigure) and
    // as a defence-in-depth default. It is NOT the hot path.
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/img/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      const res = await router.handle(request, env, ctx);
      return res ?? problem(404, "no_route");
    } catch (err) {
      // Never leak stack traces to the browser; Workers Logs has the detail.
      console.error("unhandled", err);
      return problem(500, "internal");
    }
  },
} satisfies ExportedHandler<Env>;
```

Every route returns through `withSecurityHeaders()` because `_headers` does not cover Worker responses.

### 2.2 `routes/data.ts` — responsibilities

- `handleIndex` — fetch `https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{REPO_BRANCH}/data/index.json`, `cf: { cacheTtl: DATA_INDEX_TTL, cacheEverything: true }`. Respond `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=300` + `ETag` passthrough. Short because `index.json.last_updated` is what `web/src/lib/cache.ts:isCacheFresh` compares against.
- `handleShard` — same, but validate the shard name against `/^data_\d{3}\.jsonl$/` **before** building the upstream URL (path-traversal guard: this is the only place a client-controlled string reaches a `fetch()` URL). TTL `DATA_SHARD_TTL`. Respond with `Content-Type: application/x-ndjson`.
- `purgeData(env, shardName?)` — exported for `admin/commit.ts` to call after a successful `update-ref`, deleting `index.json` and the touched shard from `caches.default`. Without this, a commit is invisible for up to `DATA_SHARD_TTL`.

Why proxy at all rather than keep hitting raw.githubusercontent directly: it makes the data same-origin (so it obeys the app's own CSP `connect-src 'self'`, is edge-cached in ~300 PoPs instead of hitting GitHub per visitor, and drops one cross-origin preconnect), and it lets the commit path invalidate the cache deterministically. `cache: "no-store"` in `web/src/lib/fetcher.ts:22,39` should become `cache: "default"` once the edge is authoritative — otherwise every visitor bypasses their own browser cache for 5.9 MB.

### 2.3 `routes/img.ts` — responsibilities

URL shape (deterministic, cacheable, and **not** an open proxy):

```
/img/{width}/{hostToken}/{steamPath}?t={steamVersion}
     ^184|460  ^a|f       ^store_item_assets/steam/apps/730/header.jpg
```

`hostToken` maps `a → shared.akamai.steamstatic.com`, `f → shared.fastly.steamstatic.com` — the only two hosts that appear in the dataset (verified above).

- `validate` — reject unless: `width ∈ {184, 460}`, `hostToken ∈ {a, f}`, path matches `^store_item_assets/steam/apps/\d+/[A-Za-z0-9/_-]*\.(jpg|png)$`, and the query has only `t`. Anything else → `400`. This is the whole reason for the token scheme; taking a raw `?url=` would make the Worker an open image proxy on your own domain and your own bill.
- `resolve` — for `width === 184`, rewrite the filename `header.jpg → capsule_184x69.jpg` **server-side** (which also fixes the 214 `header_alt_assets_*.jpg` records that `headerToCapsule()` misses today: the Worker can fall back to a `cf.image` resize when the capsule variant 404s).
- `serve` — check `caches.default` first; on miss, `fetch(upstream, IMG_TRANSFORM === "true" ? { cf: { image: { width, fit: "scale-down", format: "auto", quality: 75 } } } : {})`; `ctx.waitUntil(cache.put(...))`.
- Response headers: `Cache-Control: public, max-age=31536000, immutable` (safe — Steam's own `?t=` is the version token), `Content-Type` passthrough, `Vary: Accept` only when transforming.
- On upstream failure return a `302` to the original Steam URL, not a 500 — every consumer already has an `onError` fallback (`columns.tsx:42`, `MobileGameCards.tsx:104`, `GameDetailDrawer.tsx:116`, `CommandPalette.tsx:218`) but a redirect keeps the image visible.

### 2.4 Image transformation cost — the number that matters

Cloudflare's free allowance is **5,000 unique transformations/month**, then a separate Images Paid plan at $0.50/1,000. A "unique transformation" is source-image × option-set × month. The catalog has **3,424** games.

- If both the 184 thumbnail and the 460 header were transformed: ~6,848 unique/month → **over the free tier every month**.
- The design above transforms **only width 460** (detail-drawer opens): worst case 3,424/month, realistically far less. Width 184 is a filename swap + passthrough → **0 transformations**.
- `IMG_TRANSFORM=false` ships that at zero transformation cost from day one; flip it on once you can see `/img/*` volume in Workers Logs.
- Keep the option-set **fixed** (one variant per image). Adding a second width or quality doubles the unique count.

### 2.5 `routes/admin/*` — responsibilities

- `identity.ts` verifies the `Cf-Access-Jwt-Assertion` header against the Access team's JWKS and the expected `aud`. **Verify it in the Worker even though Access already gates the path** — the `*.workers.dev` hostname is not behind the Access application, so an unverified handler would be reachable there. Reject with `403` if absent/invalid.
- `queue.ts` — `GET` lists rows from D1 `new_game_queue` (populated by the Python pipeline via a `POST /api/admin/queue` authenticated with a service token); `POST /api/admin/queue/:id/approve` moves it to a draft.
- `drafts.ts` — CRUD over D1 `edit_drafts`; a draft is a JSON patch against one record, never a copy of the record.
- `commit.ts` — the only mutating path into Git. Mirrors `web/src/lib/git-data.ts` (`getHead → createBlob → createTree → createCommit → updateRef`) using a repo-scoped secret, bumps `data/index.json.last_updated`, writes an `audit_log` row, calls `data.purgeData()`, and dispatches `update-daily.yml`. GPG signing stays client-side; the Worker path produces unsigned commits unless you also move the key server-side (do not — `f2p:gpg_armored` in localStorage is already the weakest link; putting the private key in a Worker secret makes it worse).
- `migrations/0001_init.sql` — `new_game_queue(id, appid, name, payload, state, created_at)`, `edit_drafts(id, appid, patch, author, created_at, state)`, `audit_log(id, actor, action, target, before, after, at)`. D1 free tier: 5M rows read/day, 100K written/day, and since 2026-09-01 over-limit queries **hard-fail** on Free — this schema is admin-only so it will never come close, but do not be tempted to mirror the 3,424 records into D1.

---

## 3. Exact changes to `web/vite.config.ts` and `web/index.html`

### 3.1 `web/vite.config.ts`

| Line | Now | Change to | Why |
|---|---|---|---|
| 8 | `const repoName = "free-steam-games-list";` | delete | no longer referenced |
| 17 | `base: command === "build" ? \`/${repoName}/\` : "/"` | `base: "/"` | Worker serves from the domain root. Also fixes the desktop/mobile manifest bug in §0. |
| 32 | `injectRegister: "auto"` | `injectRegister: "script-defer"` | `auto` injects an **inline** script that the CSP in §1.3 would block |
| 44 | `scope: command === "build" ? ... : "/"` | `scope: "/"` | |
| 45 | `start_url: ...` | `start_url: "/"` | |
| 49, 55 | `src: "icon-192.svg"` / `"icon-512.svg"` | `"/icon-192.svg"` / `"/icon-512.svg"` | **required** — see §4.4; relative manifest icon paths resolve against the *manifest* URL today but break the moment the manifest is fetched from a deep route |
| 72 | `globIgnores: ["404.html"]` | delete the option; delete `web/public/404.html` | `not_found_handling: "single-page-application"` replaces it. Keeping a 404.html that hard-links `/free-steam-games-list/#/` (lines 34-35 of that file) would be actively wrong. |
| 76 | `navigateFallback: command === "build" ? \`/${repoName}/index.html\` : "/index.html"` | `navigateFallback: "/index.html"` | |
| after 76 | — | **add** `navigateFallbackDenylist: [/^\/api\//, /^\/img\//]` | without it a SW navigation preload can shadow the Worker routes |
| 87-88 | `urlPattern: /^https:\/\/raw\.githubusercontent\.com\/poli0981\/free-steam-games-list\/main\/data\/.*/` | `urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith("/api/data/")`, `cacheName: "f2p-data-v3"` | data is now same-origin. **Bump the cache name** — `f2p-data-v2` entries are keyed on the old absolute URLs and would never be evicted otherwise. |
| 99-108 | `steam-headers` CacheFirst on `shared.akamai...` | either add `shared\.fastly\.` to the pattern, **or** delete the rule entirely once all images route through `/img/*` | 44% of images are on fastly and uncached today |
| 112-120 | `weserv-webp` CacheFirst on `images.weserv.nl` | replace with `urlPattern: ({ url }) => url.pathname.startsWith("/img/")`, `cacheName: "f2p-img-v1"`, `CacheFirst`, `statuses: [200]` | weserv is retired |
| 121-130 | `gh-avatars` SWR | keep unchanged | avatars still come from GitHub |

Also delete the `--base /` from `build:desktop` and `build:mobile` in `web/package.json:9-10` once `base` is unconditionally `/` (harmless either way, but it is now misleading).

### 3.2 `web/index.html`

| Line | Now | Change to |
|---|---|---|
| 2 | `<html lang="vi" class="dark">` | `<html lang="en" class="dark">` — the built `manifest.webmanifest` already declares `"lang":"en"`, `i18next` resolves per-user, and `og:locale` says `vi_VN` while the default resource bundle is English. Pick one; `en` matches the shipped default. (If Vietnamese really is the primary audience, change the manifest and OG instead — but the two must agree.) |
| 5 | `href="favicon.svg"` | `href="/favicon.svg"` — **required**, see §4.4 |
| 10 | `<link rel="preconnect" href="https://raw.githubusercontent.com" crossorigin />` | delete (data is same-origin now) |
| 11 | `<link rel="preconnect" href="https://shared.akamai.steamstatic.com" />` | delete both preconnects; images are same-origin via `/img/*`. If you keep direct Steam URLs anywhere, add `shared.fastly.steamstatic.com` too. |
| 15 | `content="Curated list of 1,200+ …"` | `3,400+` (actual 3,424 per `data/index.json`) |
| 20 | `<link rel="canonical" href="https://poli0981.github.io/free-steam-games-list/" />` | `https://free-steam-games.win/` |
| 26 | `og:title` "1,200+ free-to-play games" | `3,400+` |
| 29 | `og:description` "1,200+" | `3,400+` |
| 31 | `og:url` | `https://free-steam-games.win/` |
| 32 | `og:image` | `https://free-steam-games.win/og.png` — and **switch from SVG to PNG**. `og:image:type` is `image/svg+xml` (line 33); Facebook, Twitter/X, Slack, Discord and iMessage all refuse SVG OG images, so the card is currently blank everywhere. Generate a 1200×630 PNG, update lines 33-35 to `image/png` / `1200` / `630`. |
| 36 | `og:locale content="vi_VN"` | `en_US`, alternate `vi_VN` (must match line 2) |
| 44 | `twitter:image` | same PNG URL |
| 40 | `twitter:card content="summary"` | `summary_large_image` (you will have a 1200×630 asset) |
| 55 | `"@id": "…github.io/free-steam-games-list/#website"` | `https://free-steam-games.win/#website` |
| 56 | `"url"` | `https://free-steam-games.win/` |
| 60 | `"description": "…1,200+…"` | `3,400+` |
| 75-79 | `SoftwareApplication` with no `@id`/`url` | add `"@id": "https://free-steam-games.win/#app"`, `"url": "https://free-steam-games.win/"`, and split `"license"` into code vs data once the dual-license lands |

Also `web/public/robots.txt:4` → `Sitemap: https://free-steam-games.win/sitemap.xml`, and `web/public/sitemap.xml` — with BrowserRouter every route becomes a real, indexable URL, so replace the single `<loc>` with the actual route list (`/`, `/games`, `/top-online`, `/top-offline`, `/charts/genres` … `/charts/delisted`, `/about`). That is the single biggest SEO win of this migration and it is free.

---

## 4. HashRouter → BrowserRouter

### 4.1 Does BrowserRouter break the Tauri webview?

**No — but only because of two facts I verified, and one of them is platform-specific enough that I would still ship the split.**

1. **Tauri 2 does have an SPA fallback.** `crates/tauri/src/manager/mod.rs` (tag `tauri-v2.11.1`, which is the version pinned in `web/src-tauri/Cargo.lock:3945-3947`) implements a three-tier fallback in `get_asset`: `{path}.html`, then `{path}/index.html`, then **unconditionally `index.html`**, with debug logs `"Asset \`{path}\` not found; fallback to index.html"`. So `tauri://localhost/games/730` serves the app shell.
2. **WebKit's pushState path restriction is `file:`-only.** `Source/WebCore/page/History.cpp` guards it with `if (fullURL.protocolIsFile() && linkedOnOrAfterSDKWithBehavior(SDKAlignedBehavior::PushStateFilePathRestriction) …)`. Tauri on macOS/Linux uses `tauri://localhost` (a custom scheme with a host), not `file:`, so `history.pushState("/games/730")` passes the protocol/host/port equality check and is allowed. On Windows and Android the scheme is `http://tauri.localhost` (or `https://` with `useHttpsScheme`), which is trivially fine.

**Residual risk I could not eliminate from a read-only machine:** I have no macOS or Android device here to run it on, and the historical Tauri/wry issues in this area (wry#170, tauri#1642) were real. The cost of being wrong is a desktop app that renders a blank window on navigation — a shipped-binary regression, not a hotfixable one.

**Therefore: ship the split.** It is three lines and removes the risk entirely.

```tsx
// web/src/main.tsx — replaces the HashRouter import at line 4 and use at 29/46
import { BrowserRouter, HashRouter } from "react-router-dom";
import { isTauri } from "./lib/external-open";

// Web/PWA gets real URLs (SEO, deep links, sitemap). The packaged app keeps
// hash routing: Tauri 2.11 does fall back to index.html and WebKit's pushState
// restriction is file:-only, so BrowserRouter *should* work there — but a
// routing regression in a shipped desktop/Android binary is not hotfixable,
// and hash routing costs the desktop build nothing.
const Router = isTauri() ? HashRouter : BrowserRouter;
```

`isTauri()` (`web/src/lib/external-open.ts:11-16`) reads `window.__TAURI_INTERNALS__`, which Tauri injects before the bundle runs, so it is safe at module scope. On react-router 7 the `<BrowserRouter>`/`<HashRouter>` components still exist, so this survives the upgrade unchanged; if you move to `createBrowserRouter`/`RouterProvider`, the same ternary picks `createHashRouter`.

### 4.2 Every site that assumes hash routing or the `/free-steam-games-list/` base

| File:line | What it assumes | Fix |
|---|---|---|
| `web/src/main.tsx:4,29,46` | `HashRouter` | the ternary above |
| `web/src/pages/Add.tsx:79` | `onClick={() => (window.location.hash = "#/settings")}` | `const navigate = useNavigate(); navigate("/settings")` — under BrowserRouter this line silently appends `#/settings` to the current path and navigates nowhere |
| `web/src/stores/auth.ts:71` | `window.location.hash = "#/settings"` inside a toast action | same bug, harder to spot. This is in a zustand store with no router access — export a navigate function set once from a `<Router>`-mounted effect, or dispatch a custom event the Layout listens for. Do **not** use `window.location.assign("/settings")` (full reload, drops the toast). |
| `web/public/404.html:34,35` | `href="/free-steam-games-list/#/"` | delete the whole file (§3.1) |
| `web/public/404.html` (existence) | GitHub Pages' error document | replaced by `not_found_handling` |
| `web/public/robots.txt:4` | Pages sitemap URL | new host |
| `web/public/sitemap.xml:4` | Pages URL, single entry | new host + real route list |
| `web/vite.config.ts:17,44,45,76` | base/scope/start_url/navigateFallback | §3.1 |
| `web/src/pages/About.tsx:376,396` | `src="qr/telegram-bot.png"` — **relative** | `src="/qr/telegram-bot.png"`. Under HashRouter the path is always `/free-steam-games-list/` so this resolves correctly. Under BrowserRouter it happens to still work at `/about` (one segment) and would break instantly if About ever moved to `/docs/about`. Fix it now. |
| `web/index.html:5` | `href="favicon.svg"` — relative | `/favicon.svg` — see §4.4 |
| `web/vite.config.ts:49,55` | manifest `icon-192.svg` — relative | `/icon-192.svg` |
| `web/src/components/common/ConsentGate.tsx:29` | `location.pathname.startsWith("/error")` | **no change needed.** `useLocation().pathname` is router-relative and identical under both routers. The comment on line 25-26 mentioning "the GitHub Pages 404.html redirect" becomes stale. |
| `web/src/lib/lazy.ts:64` | `window.location.reload()` after a chunk 404 | **no change needed, but re-verify.** Under BrowserRouter the reload happens at e.g. `/charts/tags`; Cloudflare's SPA fallback returns `index.html` (200), the SW picks up `navigateFallback: "/index.html"`, and the fresh chunk loads. The `sessionStorage` guard (`f2p:chunk-reload`) still prevents a loop. |
| `web/src/lib/external-link-interceptor.ts:33` | `if (href.startsWith("#") \|\| href.startsWith("/")) return;` | **no change needed.** BrowserRouter `<Link>` renders `href="/games"`, already covered by the `startsWith("/")` branch. The `startsWith("#")` branch becomes dead code on web but is still live in the Tauri build. |
| `web/src/lib/oauth-device.ts:15-17` | OAuth App "Homepage URL" = Pages URL | update the comment **and** the GitHub OAuth App settings; Device Flow does not redirect, but the field is validated |
| `.github/ISSUE_TEMPLATE/bug_report.yml:76` | permalink format `…/#/games/{appid}` | `https://free-steam-games.win/games/{appid}` |

Nothing else in `web/src` touches `location.hash` or `import.meta.env.BASE_URL` — I grepped for `location.hash`, `window.location`, `BASE_URL`, `import.meta.env.BASE`, `HashRouter`, `createHashRouter` and `free-steam-games-list` across all `.ts`/`.tsx`. The remaining `window.location` hits are three `.reload()` calls (`AppErrorBoundary.tsx:32`, `QueryState.tsx:56`, `ErrorPage.tsx:94`) and one `new URL(href, window.location.href)` — all router-agnostic.

### 4.3 The Tauri service worker, which the base change unmasks

`web/dist/manifest.webmanifest` currently ships `"start_url":"/free-steam-games-list/"` in the *desktop* build too (§0). Once `base: "/"` is unconditional that specific bug disappears — but a service worker inside a packaged app is still wrong: it caches the app shell inside the webview, so the Tauri updater ships a new binary whose webview then serves the *old* precached shell. Add to `web/vite.config.ts`:

```ts
VitePWA({
  disable: mode === "desktop" || mode === "mobile",  // + build:desktop → `vite build --mode desktop`
  ...
})
```

Flagging it here because it lives in the same three lines you are already editing.

### 4.4 The subtle one: relative asset URLs under an SPA fallback

Under HashRouter the document URL is always `/free-steam-games-list/`, so relative hrefs resolve against a fixed base. Under BrowserRouter, `index.html` is served verbatim at `/games/730` — and `<link rel="icon" href="favicon.svg">` then resolves to `/games/favicon.svg`, which the SPA fallback answers with **`index.html` itself**, `Content-Type: text/html`, HTTP 200. You get no console error, no broken-image icon — just a silently wrong favicon and a wasted request per deep-link load. Same for the manifest's `icon-192.svg` and About's `qr/*.png`. This is the single most likely thing to be missed; the fixes are in §4.2.

---

## 5. DNS + zone setup, in order

The zone is already active on Cloudflare (verified §0), so steps 1-2 are confirmation only.

**1. Confirm nameservers.** Dashboard → `free-steam-games.win` → Overview should read *Active*. Registrar NS must be `charles.ns.cloudflare.com` / `desi.ns.cloudflare.com`. Already true.

**2. Do not create A/AAAA for the apex by hand.** The `custom_domain: true` route in `wrangler.jsonc` makes Cloudflare create and own the proxied apex record and issue the edge certificate on first deploy. If you pre-create a record, the first deploy fails with a conflict. Today the apex is NOERROR/NODATA — exactly the clean state you want.

**3. SSL/TLS.** SSL/TLS → Overview → encryption mode **Full (strict)**. (A Worker custom domain terminates at Cloudflare and there is no origin server, so Flexible/Full are meaningless here, but Full (strict) is the correct setting and prevents surprises if you ever add an origin.) Edge Certificates → **Always Use HTTPS: On**, **Minimum TLS Version: 1.2**, **Opportunistic Encryption: On**, **Automatic HTTPS Rewrites: On**.

**4. www → apex.** Two dashboard objects, both free, both evaluated *before* Workers (this is why the redirect cannot live in the Worker — see the `run_worker_first` note in §1.2):
   - DNS → Add record: type **AAAA**, name `www`, content `100::`, **Proxied (orange cloud)**. This is Cloudflare's documented placeholder for redirect-only hostnames; the address is the IPv6 discard prefix and is never actually contacted.
   - Rules → Redirect Rules → Create → *Single Redirect*. Expression `http.host eq "www.free-steam-games.win"`, target `concat("https://free-steam-games.win", http.request.uri.path)`, status **301**, **preserve query string: on**.

**5. HSTS — last, and only after everything works on HTTPS.** SSL/TLS → Edge Certificates → HTTP Strict Transport Security → Enable, `max-age=31536000` (start at `300` for a day if you want an escape hatch), **includeSubDomains: on**, **Preload: off** until you are certain. HSTS is effectively irreversible for the duration of `max-age`; turning it on before the redirect and certificate are verified can lock visitors out of the site.

**6. Create D1** (once, from `web/`): `npx wrangler d1 create f2p-admin` → paste the returned `database_id` into `wrangler.jsonc`. Then `npx wrangler d1 migrations apply f2p-admin --remote`.

**7. Connect Workers Builds.** Dashboard → Workers & Pages → the `f2p-tracker` Worker → Settings → Build → Connect a repository → `poli0981/free-steam-games-list`.

| Setting | Value | Why |
|---|---|---|
| Production branch | `main` | |
| **Root directory** | `web` | where `wrangler.jsonc`, `package.json` and `package-lock.json` live; dependency install is auto-detected from the lockfile here |
| **Build command** | `npm run build` | `tsc -b && vite build`; do not add `npm ci`, Workers Builds runs the install itself |
| **Deploy command** | `npx wrangler deploy` | the default. Non-production branches automatically switch to `npx wrangler versions upload`, giving you preview URLs for free |
| **Build variables** | none needed unless you wire `VITE_GH_OAUTH_CLIENT_ID` / `VITE_GH_OAUTH_PROXY` — those are baked at build time, so they belong here, not in `vars` |

**8. Build watch paths — the decision the brief asks you to make explicit.** Cloudflare evaluates **excludes first**, then includes; a build is triggered if any remaining changed path matches an include. Defaults are include `[*]`, exclude `[]`. Path matching is bypassed entirely when a push has zero file changes, **3,000+ file changes, or 20+ commits**.

Your pipeline commits to `data/**` many times a day. The app fetches data at **runtime** from GitHub through the Worker — a data commit changes nothing in `dist/`. So:

```
Include paths:  web/*
Exclude paths:  web/README.md, web/src-tauri/*
```

**A data-only commit will explicitly NOT redeploy.** That is correct and intentional: the Worker proxies `raw.githubusercontent.com` at request time with a 60s/300s edge TTL, so new data is live within a minute with no build. Rebuilding the SPA on every `chore(data): mark dead games` commit would burn build minutes for a byte-identical bundle.

Caveat to write down somewhere: this means `data/index.json`'s `last_updated` is the *only* freshness signal, and `admin/commit.ts` must purge the edge cache (§2.2) — otherwise an owner edit is invisible for up to 5 minutes and there is no build to blame.

---

## 6. Migration and rollback

### 6.1 Bookmarked `#/` URLs

Fragments are never sent to the server, so no `_redirects` rule, Redirect Rule, or Worker route can see them (Cloudflare's `_redirects` docs are explicit: "any fragments in the source are not evaluated"). It must be client-side, and it must run before React mounts.

`web/public/hash-shim.js` (external, so the §1.3 CSP does not need `'unsafe-inline'`):

```js
// Legacy #/ URLs from the GitHub Pages era (and from the Tauri build, which
// still uses hash routing). Rewrite before the app boots so BrowserRouter
// picks up the real path and the user never sees the dashboard flash.
// No-op inside Tauri, where #/ is the live scheme.
(function () {
  if (window.__TAURI_INTERNALS__) return;
  var h = location.hash;
  if (h.length > 2 && h.charAt(1) === "/") {
    history.replaceState(null, "", h.slice(1) + location.search);
  }
})();
```

Referenced from `web/index.html` `<head>`, **before** `<script type="module" src="/src/main.tsx">`:

```html
<script src="/hash-shim.js"></script>
```

Blocking and ~200 bytes. `replaceState` (not `pushState`) so Back does not bounce into the old URL. Keep it for at least 12 months — the Tauri desktop and Android builds emit `#/` links, and users share those.

Verify against the real legacy shapes: `#/`, `#/games`, `#/games/730`, `#/charts/anti-cheat/list`, `#/settings`, `#/error/419`.

### 6.2 The old service worker on `poli0981.github.io` — the trap

This is the part that bites. Every existing visitor has a Workbox SW registered at scope `/free-steam-games-list/` on `poli0981.github.io`, with the app shell **precached**. If you simply delete `deploy-pages.yml`, those users keep getting the old app from cache forever — it will still work (it reads data from `raw.githubusercontent.com`), so they will never know the site moved, and it will slowly rot as the schema drifts.

Do a **final tombstone deploy to Pages**, then stop:

1. One last Pages build whose `index.html` is a standalone page (no bundle) that: unregisters every SW under that scope, deletes all `caches.keys()` entries, then `location.replace("https://free-steam-games.win" + (location.hash.slice(1) || "/"))` — carrying the deep link across.
2. Ship it with `VitePWA({ selfDestroying: true })` (or hand-write the page and skip VitePWA entirely) so Workbox emits a self-destroying SW that takes control and removes its own precache.
3. Leave that deploy in place. Then delete `deploy-pages.yml` **and** `notify-deploy.yml` (§0 — it triggers on the deploy workflow's name and would otherwise be a permanently dead workflow).
4. GitHub Pages cannot issue a 301. The `location.replace` above is the redirect. Set `<meta name="robots" content="noindex">` and `<link rel="canonical" href="https://free-steam-games.win/">` on the tombstone so Google consolidates to the new host.

Rollback path: if the Worker deploy goes wrong, re-enable `deploy-pages.yml` from git history and push. Because the tombstone is just another commit, reverting it restores the old app. Keep this option for ~30 days.

### 6.3 localStorage does not migrate — warn the owner explicitly

Different origin, so **everything under `f2p:*` is gone**: `f2p:legal_consent` (every visitor re-consents — arguably good, since the terms change anyway), `f2p:theme`, `f2p:lang`, and for the owner **`f2p:gh_token` and `f2p:gpg_armored`**. The GPG private key is stored armored in localStorage (`web/src/gpgauth/`), and on the old origin it is only reachable while Pages still serves the app.

**Before the tombstone deploy**, the owner must export the armored key from `poli0981.github.io` and re-import it on `free-steam-games.win`, and re-paste the PAT. If the tombstone's `caches`/SW cleanup ever grows into a `localStorage.clear()`, that key is destroyed. Do not put a `localStorage.clear()` in the tombstone.

The IndexedDB cache (`f2p:records` / `f2p:index`, `web/src/lib/cache.ts`) also resets — that is just one 5.9 MB re-download.

### 6.4 The 25 tracked references to the old URL

`git grep -c poli0981.github.io` (excluding `.claude/worktrees/`):

```
web/index.html                            6   §3.2
README.md                                 5
CONTRIBUTING.md                           2
.github/ISSUE_TEMPLATE/bug_report.yml     2   (one is the #/games/{appid} permalink format)
AUTHORS.md                                1
CHANGELOG.md                              1   ← historical entry, leave it
games/README.md                           1
docs/PRIVACY_POLICY.md                    1   ← must change anyway (Worker + D1 + Access break its "no backend" claim)
scripts/generate_tables.py                1   ← generated markdown links; changing it rewrites games/*.md on next run
web/README.md                             1
web/public/robots.txt                     1   §3.2
web/public/sitemap.xml                    1   §3.2
web/src/lib/oauth-device.ts               1   §4.2
.github/workflows/release-android.yml     1   release-notes body
.github/workflows/release-desktop.yml     1   release-notes body
```

Change all except `CHANGELOG.md` (historical record — a changelog that rewrites its own history is worse than a stale URL). `scripts/generate_tables.py` is the one with a side effect: editing it makes the next `generate_tables` run rewrite every `games/*.md`, producing one large commit — do it deliberately, in its own commit.

### 6.5 Cutover order

1. Land `wrangler.jsonc`, `worker/`, `_headers`, the Vite/index.html/router changes, and the hash shim on a branch. Workers Builds gives you a preview URL (`versions upload`) for every non-production branch — test BrowserRouter deep links, `/api/data/index.json`, `/img/184/a/...`, and the SPA fallback there first.
2. Owner exports the GPG key and PAT.
3. Merge to `main` → Workers Builds deploys → apex custom domain is created. Verify `https://free-steam-games.win/charts/anti-cheat/list` loads directly (not just via in-app navigation) — that single URL exercises the SPA fallback, the base path, and the router all at once.
4. Add the www placeholder + Redirect Rule; verify.
5. Enable HSTS.
6. Tombstone deploy to Pages; then delete `deploy-pages.yml` + `notify-deploy.yml`.
7. Update the 24 doc references and the GitHub OAuth App homepage/callback URL.
8. Ship the Tauri release **last**, after the web app is proven — the desktop build keeps hash routing and is unaffected by the origin change, but it does need the `VitePWA({ disable })` fix and the new CSP.

---

## 7. Things I could not verify

- **BrowserRouter on macOS/Linux/Android Tauri, empirically.** The source reads say it works (§4.1); no device here to run it. Mitigated by the `isTauri()` split, which makes the question moot.
- **Whether `_headers` `/*` rules apply to the SPA-fallback response** for a deep path. Mitigated by putting security headers on `/*`, which is correct under either behaviour.
- **Cloudflare Image Transformations enablement.** The transform-via-Workers doc states `cf.image` is available on any zone hosting a Worker including `workers.dev`, and does not mention a dashboard toggle or plan gate; the brief's 5,000-free/$0.50-per-1,000 figures are consistent with that but I did not open a pricing page. Check Images → Transformations in the dashboard before flipping `IMG_TRANSFORM=true`.
- **The `f2p-admin` D1 `database_id`** — it does not exist yet; `wrangler d1 create` produces it.
- **Whether `run_worker_first` array patterns support anything beyond leading/trailing wildcards.** `"/api/*"` and `"/img/*"` are the documented shape and are all this design uses.
- The `.claude/worktrees/` directories contain stale copies of the repo; I excluded them from every count and treated `git grep` output as authoritative.

Sources: [Cloudflare — SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), [Worker script routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [Static assets headers](https://developers.cloudflare.com/workers/static-assets/headers/), [Static assets redirects](https://developers.cloudflare.com/workers/static-assets/redirects/), [Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/), [Static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Platform limits](https://developers.cloudflare.com/workers/platform/limits/), [Transform images via Workers](https://developers.cloudflare.com/images/transform-images/transform-via-workers/), [tauri manager/mod.rs @ tauri-v2.11.1](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.11.1/crates/tauri/src/manager/mod.rs), [WebKit History.cpp](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/page/History.cpp), [tauri useHttpsScheme](https://v2.tauri.app/reference/config/).