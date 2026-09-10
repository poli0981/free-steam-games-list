Read everything. Here is the design.

---

# Images + Caching/Performance on Cloudflare — design

## 0. Corrections to the brief (all verified against the repo/network)

These change the design materially, so they come first.

| Brief says | Reality | Evidence |
|---|---|---|
| 3 consumers of `lib/image.ts` | **4.** `components/common/CommandPalette.tsx:29,211` also calls `headerToCapsule` | grep |
| Images come from `shared.akamai.steamstatic.com` | **Two hosts.** 1,927 records on `shared.akamai.steamstatic.com`, **1,496 on `shared.fastly.steamstatic.com`**, 1 empty | counted across `data/data_00{1..5}.jsonl` |
| SW `steam-headers` rule caches Steam thumbs | Regex at `web/vite.config.ts:94-95` matches **only** `shared.akamai` → **44% of all thumbnails are not service-worker cached today** | `vite.config.ts:95` |
| Path shape is `/steam/apps/<appid>/header.jpg` | Actual: `/store_item_assets/steam/apps/<appid>[/<40-hex-hash>]/<asset>.jpg?t=<epoch>`. **1,620 records (47.3%) carry the 40-hex content-hash directory.** All 3,423 non-empty URLs carry `?t=` | sampled + aggregated |
| `headerToCapsule` saves bandwidth | **It is broken for 47% of the catalog.** At hashed paths, `capsule_184x69.jpg` — and `capsule_231x87`, `capsule_616x353`, `capsule_sm_120`, `library_600x900` — **all return 404**. Only `header.jpg` exists there | 4/4 sampled hashed paths returned 404; flat path `apps/730` returned 200/6,568 B |
| ~5.9 MB JSONL on first load | **6,063,904 B raw, but 1,001,569 B on the wire** — `raw.githubusercontent.com` already gzips (`data_001.jsonl`: 1,526,699 → 242,666, `Content-Encoding: gzip`, `Cache-Control: max-age=300`) | `curl -H 'Accept-Encoding: gzip'` |
| "font loading" is a lever | **There are no web fonts.** No `@font-face`, no `fonts.googleapis`, no `.woff2` in `web/public/`. `web/tailwind.config.ts:50-52` names `Inter`/`JetBrains Mono` that are **never loaded** — every user gets `system-ui`. `vite.config.ts:64` precaches `woff2` that don't exist | grep + `ls web/public` |
| ECharts is on the Dashboard critical path | Already behind a lazy boundary (`components/charts/LazyEChart.tsx:11-13`); the three Dashboard charts import `LazyEChart` (`GenreTreemap.tsx:2`, `PlatformsDonut.tsx:2`, `TopOnlineBar.tsx:2`). The problem is **waterfall position**, not bundle inclusion — see §5 | read |

**The single most consequential finding:** `web/src/lib/image.ts:11-14`

```ts
export function headerToCapsule(url: string): string {
  if (!url || !url.includes("header.jpg")) return url;
  return url.replace("header.jpg", "capsule_184x69.jpg");
}
```

For 1,620 games this issues a request that 404s (146 B + a full RTT), the `onError` handler at `columns.tsx:40-43` / `MobileGameCards.tsx:99-105` / `CommandPalette.tsx:216-219` fires, and the browser then downloads the **full 34 KB `header.jpg` into a 64×32 CSS-pixel slot**. The comment at `MobileGameCards.tsx:100-102` ("capsule_184x69 variant 404s for some games") shows this was noticed but never quantified.

Measured averages (n=15 each, `Content-Length`):

| asset | avg | max |
|---|---|---|
| `header.jpg` (flat paths) | 33,522 B | 55,795 B |
| `header.jpg` (hashed paths) | 34,656 B | 62,476 B |
| `capsule_184x69.jpg` (flat only) | 6,890 B | — |

Weighted cost of one full table scroll **today**: `1803×6,890 + 1620×(146+34,656)` = **68.8 MB** for 3,423 thumbnails (≈20.1 KB average per 64×32 thumbnail).

Two more verified facts that drive the design:

- **`shared.akamai` and `shared.fastly` are byte-identical mirrors of the same path space.** 4/4 fastly-sourced URLs returned identical `Content-Length` (3,094 / 57,862 / 16,612 / 62,399) when the host was swapped to akamai. → the Worker can normalize two hosts to one upstream, halving cache entries.
- **Steam does not content-negotiate WebP.** `Accept: image/webp` on `header.jpg` still returns `image/jpeg`. Steam sends `Cache-Control: public, max-age=315262591` + `Access-Control-Allow-Origin: *`. → any WebP win must be produced by us.

Reference WebP sizes (measured through weserv, representative of what Cloudflare's encoder produces at the same quality):

| target | bytes | vs 34 KB JPEG |
|---|---|---|
| w=184 q75 webp | **2,796** | 12.3× |
| w=368 q75 webp | 6,792 | 5.1× |
| w=460 q75 webp | **11,098** | 3.1× |
| w=920 q75 webp | 20,564 | 1.7× |

---

## 1. Worker image route

### 1.1 URL shape

Do **not** accept a source URL as a parameter — that is what makes an open proxy. Encode only the *catalog coordinates*, and let the Worker reconstruct the upstream URL from a template it owns.

```
/img/<variant>/<appid>[/<40-hex>]/<asset>.jpg?t=<epoch>
```

Examples:
```
/img/t/730/header.jpg?t=1749053861
/img/d/3659080/83980241cde882382e0e6d8f66c8b44a926a324e/header.jpg?t=1766134821
```

Properties:
- **The host is gone from the URL.** Both Steam hosts are mirrors, so the Worker always fetches akamai and falls back to fastly on a non-200. One canonical cache entry per asset instead of two.
- **`?t=` is preserved** and forwarded upstream. It is Steam's own asset mtime, so it is a natural content version: when art changes, the URL changes, so `immutable` caching is correct and **no purge mechanism is ever needed**.
- **Path structure is preserved verbatim** (optional 40-hex directory + filename), so `lib/image.ts` becomes a pure string rewrite with no lookup table.

### 1.2 Variants (fixed enum, no arbitrary `w=`)

| token | cf.image | use | consumers |
|---|---|---|---|
| `t` | `184×69 cover q72` | every thumbnail | `columns.tsx:32` (64×32 CSS → 128 @2x), `MobileGameCards.tsx:91` (80×40 → 160 @2x), `CommandPalette.tsx:211` (28×16) |
| `d` | `460×215 cover q78` | detail hero 1x | `GameDetailDrawer.tsx:106` |
| `d2` | `920×430 cover q72` | detail hero 2x (`srcset`) | `GameDetailDrawer.tsx` |

**One thumb variant, not two.** 184w covers the largest thumbnail slot (80 CSS px) at DPR 2.3. A separate `t2x` would double the transformation bill for a slot nobody inspects at 2×. This is the single biggest cost lever after §3.

**Pin `format: "webp"`, do not use `format: "auto"`.** `auto` emits AVIF for AVIF-capable clients, and each distinct option set is a distinct billable unique transformation — `auto` silently 2–3×'s the bill for a ~10% byte win. Fall back to `jpeg` only when `Accept` lacks `image/webp` (sub-1% of traffic in 2026).

### 1.3 Anti-abuse: the appid allowlist

Regex-constraining the path stops the endpoint being a *general* proxy, but not a *Steam* proxy — anyone could hit `/img/d2/<any appid>/header.jpg` and burn your transformation quota on the 200,000+ apps on Steam. Bound it structurally:

Ship a `web/public/appids.bin` — the 3,424 catalog appids as a sorted `Uint32Array` (**13,696 bytes**), generated by the Python pipeline alongside `data/index.json`. The Worker loads it once into a module-global and binary-searches. Unknown appid → 404, zero subrequests, zero transformations.

### 1.4 Skeleton

```ts
// web/worker/index.ts  (wrangler main)

const UPSTREAMS = [
  "https://shared.akamai.steamstatic.com",
  "https://shared.fastly.steamstatic.com",
] as const;

// /img/<variant>/<appid>[/<40hex>]/<asset>.jpg
const IMG_RE =
  /^\/img\/(t|d|d2)\/(\d{1,8})(?:\/([0-9a-f]{40}))?\/((?:header|header_russian|header_alt_assets_\d{1,3}|capsule_231x87)\.jpg)$/;

const VARIANTS = {
  t:  { width: 184, height: 69,  fit: "cover", quality: 72 },
  d:  { width: 460, height: 215, fit: "cover", quality: 78 },
  d2: { width: 920, height: 430, fit: "cover", quality: 72 },
} as const;

const IMMUTABLE = "public, max-age=31536000, immutable";

let APPIDS: Uint32Array | null = null;
async function knownAppid(env: Env, id: number): Promise<boolean> {
  if (!APPIDS) {
    const r = await env.ASSETS.fetch(new URL("/appids.bin", "https://x/"));
    APPIDS = new Uint32Array(await r.arrayBuffer()); // sorted, 13.7 KB
  }
  let lo = 0, hi = APPIDS.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (APPIDS[m] === id) return true;
    APPIDS[m] < id ? (lo = m + 1) : (hi = m - 1);
  }
  return false;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/img/")) return handleImg(req, url, env, ctx);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env, ctx); // D1/admin, separate design
    return env.ASSETS.fetch(req); // static assets + SPA fallback
  },
} satisfies ExportedHandler<Env>;

async function handleImg(req: Request, url: URL, env: Env, ctx: ExecutionContext) {
  if (req.method !== "GET" && req.method !== "HEAD")
    return new Response("Method Not Allowed", { status: 405 });

  const m = IMG_RE.exec(url.pathname);
  if (!m) return new Response("Not Found", { status: 404 });

  const [, variant, appidStr, hash, asset] = m;
  const appid = Number(appidStr);
  if (!(await knownAppid(env, appid)))
    return new Response("Not Found", { status: 404 });

  // ?t= must be digits-only; anything else is dropped (not echoed) so the
  // query string can never be used to vary the cache unboundedly.
  const t = url.searchParams.get("t");
  const ts = t && /^\d{1,12}$/.test(t) ? t : null;

  // Deterministic format => deterministic cache key, no Vary: Accept poisoning.
  const fmt = (req.headers.get("Accept") ?? "").includes("image/webp")
    ? "webp" : "jpeg";

  const path = `/store_item_assets/steam/apps/${appid}${hash ? "/" + hash : ""}/${asset}`;

  // --- Tier A: native capsule exists (flat paths only) => passthrough, 0 transforms
  const nativeCapsule =
    variant === "t" && !hash && asset === "header.jpg"
      ? `/store_item_assets/steam/apps/${appid}/capsule_184x69.jpg`
      : null;

  const cacheKey = new Request(
    `${url.origin}${url.pathname}?t=${ts ?? "0"}&f=${fmt}`,
    { method: "GET" },
  );
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const q = ts ? `?t=${ts}` : "";
  let upstream: Response | null = null;

  // Tier A first; on 404 fall through to Tier B (transform header.jpg).
  if (nativeCapsule) {
    upstream = await fetchMirror(nativeCapsule + q, {
      cf: { cacheEverything: true, cacheTtl: 2592000 },
    });
    if (!upstream.ok) upstream = null;
  }

  if (!upstream) {
    const v = VARIANTS[variant as keyof typeof VARIANTS];
    upstream = await fetchMirror(path + q, {
      cf: {
        image: { ...v, format: fmt, metadata: "none" },
        cacheEverything: true,
        cacheTtl: 2592000,
      },
    });
  }

  if (!upstream.ok) {
    // Never cache an upstream failure at the edge for a year.
    return new Response("Upstream error", {
      status: 502,
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const res = new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? `image/${fmt}`,
      "Cache-Control": IMMUTABLE,
      "CDN-Cache-Control": "public, max-age=31536000",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "Timing-Allow-Origin": "*",
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function fetchMirror(path: string, init: RequestInit): Promise<Response> {
  const a = await fetch(UPSTREAMS[0] + path, init);
  if (a.ok || a.status !== 404) return a;
  return fetch(UPSTREAMS[1] + path, init);
}
```

### 1.5 `wrangler.jsonc`

```jsonc
{
  "name": "free-steam-games",
  "main": "worker/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/img/*", "/api/*"]
  },
  "routes": [{ "pattern": "free-steam-games.win", "custom_domain": true }]
}
```

`/img/*` **must** be in `run_worker_first`. Without it, static-asset matching runs first, misses, and `single-page-application` fallback returns `index.html` with `Content-Type: text/html` as an `<img>` source — every image silently breaks.

### 1.6 `lib/image.ts` rewrite

```ts
const STEAM_RE =
  /^https:\/\/shared\.(?:akamai|fastly)\.steamstatic\.com\/store_item_assets\/steam\/apps\/(\d{1,8}(?:\/[0-9a-f]{40})?\/[a-z0-9_]+\.jpg)(\?t=\d+)?$/;

export function cdnImg(url: string, variant: "t" | "d" | "d2"): string {
  if (!url) return url;
  const m = STEAM_RE.exec(url);
  if (!m) return url;                    // unknown shape -> leave untouched
  return `${IMG_ORIGIN}/img/${variant}/${m[1]}${m[2] ?? ""}`;
}
```

- Delete `headerToCapsule` and `webpProxyUrl` entirely. The capsule swap moves into the Worker (Tier A) where it can actually verify the 404 and fall through, which the client cannot do without a wasted round-trip.
- **Remove the `isTauri()` bypass at `image.ts:37`.** The comment ("the bundled app shouldn't leak browsing signals to a third-party CDN") is correct about weserv but no longer applies: `free-steam-games.win` is first-party, and the desktop app already talks to it for data. Set `IMG_ORIGIN = "https://free-steam-games.win"` (absolute) so the Tauri webview, which has no origin of its own, resolves it. Keep the `onError` → original `header_image` fallback in all four consumers; it becomes the offline/Worker-down path.
- The Tauri CSP you are adding (`tauri.conf.json` currently `"security": { "csp": null }`) needs:
  `img-src 'self' data: https://free-steam-games.win https://shared.akamai.steamstatic.com https://shared.fastly.steamstatic.com;` — the two Steam hosts are required for the `onError` fallback to work.

---

## 2. Caching, three layers

### (a) Cloudflare edge

Make `data/` **content-addressed** so everything except one tiny document becomes immutable. `scripts/core/data_store.py:158-174` (`_save_index`) writes `{"name": "data_001.jsonl", "count": N}`; add a `sha` (first 8 hex of the file's sha256) and emit shards as `data_001.<sha8>.jsonl`. That single pipeline change is what unlocks the whole table below.

| resource | `Cache-Control` (browser) | `CDN-Cache-Control` (edge) | notes |
|---|---|---|---|
| `/img/*` | `public, max-age=31536000, immutable` | `public, max-age=31536000` | safe: `?t=` versions it |
| `/assets/*.[hash].{js,css}` | `public, max-age=31536000, immutable` | `public, max-age=31536000` | Vite fingerprints these |
| `/index.html` | `public, max-age=0, must-revalidate` | `public, max-age=60` | ETag 304s; 60 s edge so a deploy propagates fast |
| `/data/index.json` | `no-cache` | `public, max-age=30` | **the only mutable document**; ~167 B gzipped |
| `/data/data_*.<sha8>.jsonl` | `public, max-age=31536000, immutable` | `public, max-age=31536000` | hash in the name |
| `/appids.bin` | `public, max-age=300` | `public, max-age=300` | changes when the catalog does |
| `/api/*` | `private, no-store` | `no-store` | D1/admin behind Cloudflare Access |
| `/sw.js`, `/manifest.webmanifest` | `no-cache` | `public, max-age=0` | never let a SW pin itself |

Static-asset headers go in `web/public/_headers` (Workers Static Assets honours the Pages `_headers` format — **verify against current docs before relying on it**; the fallback is to route those paths through `run_worker_first` and set headers in code):

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/data/index.json
  Cache-Control: no-cache
  CDN-Cache-Control: public, max-age=30
/data/*.jsonl
  Cache-Control: public, max-age=31536000, immutable
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: public, max-age=0, must-revalidate
  CDN-Cache-Control: public, max-age=60
```

**`caches.default`:** used only in `handleImg` above, keyed on a *normalized* synthetic request (`pathname + ?t + &f`), never on the raw `Request`. Two reasons: (i) the raw request carries `Accept`, `Accept-Encoding`, and any junk query params, which fragment the cache; (ii) it prevents an attacker appending `?cachebust=N` to force fresh transformations. Always `ctx.waitUntil(cache.put(...))`; a bare `await` on `put` after returning the body will throw.

**`caches.default` is a no-op on `*.workers.dev`.** It only works on a zone. Test on `free-steam-games.win` or you will conclude the cache is broken.

**Do not use `Cache-Tag`.** Purge-by-tag is an Enterprise feature. You do not need it: every cacheable URL in this design is content-addressed (`?t=` for images, `<sha8>` for shards), so a change produces a new URL. `index.json` is the only thing that must be revalidated, and `no-cache` + 30 s edge handles it.

### (b) Workbox — `web/vite.config.ts:61-127`

**Delete:**
- `f2p-data-v2` (`vite.config.ts:81-91`) — `raw.githubusercontent.com` is no longer the data origin.
- `weserv-webp` (`vite.config.ts:106-114`) — weserv is gone.

**Change:**
- `steam-headers` (`vite.config.ts:93-102`) → keep, but this is now only the `onError` fallback path. **Fix the regex to cover both hosts** (today's is the 44%-miss bug):
  ```ts
  urlPattern: /^https:\/\/shared\.(?:akamai|fastly)\.steamstatic\.com\/.*\.jpg/,
  options: { cacheName: "steam-fallback-v1", ... }
  ```
- `navigateFallback` (`vite.config.ts:69`): `/free-steam-games-list/index.html` → `/index.html`.
- `globIgnores: ["404.html"]` (`vite.config.ts:68`) — delete `web/public/404.html` outright; it exists only for GitHub Pages, and `not_found_handling: "single-page-application"` replaces it.
- `globPatterns` (`vite.config.ts:64`) — drop `woff2`, there are none.
- `scope` / `start_url` (`vite.config.ts:44-45`) → `"/"`.
- `manifest.icons` — add a real 512×512 PNG. SVG-only icons are rejected by several install prompts, and `og:image` at `index.html:32` points at an SVG, which most social scrapers will not render.

**Add:**
```ts
{
  urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/img/"),
  handler: "CacheFirst",
  options: {
    cacheName: "f2p-img-v1",
    expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 60 },
    cacheableResponse: { statuses: [200] },
  },
},
{
  urlPattern: ({ url, sameOrigin }) =>
    sameOrigin && /^\/data\/data_.*\.jsonl$/.test(url.pathname),
  handler: "CacheFirst",              // safe: filenames carry the content hash
  options: {
    cacheName: "f2p-data-v3",
    expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
    cacheableResponse: { statuses: [200] },
  },
},
```

Note the strategy change for data: **NetworkFirst → CacheFirst is now correct**, because the shard filename changes when the content changes. The whole rationale in the comment at `vite.config.ts:71-80` ("edits appeared only after TWO reloads") disappears once URLs are content-addressed — and you get the offline behaviour *and* the freshness, instead of trading them off.

**Cache-name bump and the orphan problem.** Renaming `f2p-data-v2` → `f2p-data-v3` stops stale entries being *served* (no rule matches the old name any more) but leaves them occupying quota — Workbox's `cleanupOutdatedCaches` only touches precaches, not runtime caches. Add a one-shot purge via `workbox.importScripts: ["/sw-cleanup.js"]`:

```js
// web/public/sw-cleanup.js
const LEGACY = ["f2p-data", "f2p-data-v2", "weserv-webp", "steam-headers"];
self.addEventListener("activate", (e) =>
  e.waitUntil(Promise.all(LEGACY.map((n) => caches.delete(n)))));
```

**The migration cliff nobody will hit but everybody will complain about.** Existing users have a Service Worker registered at `poli0981.github.io/free-steam-games-list/`. That is a *different origin*; the new site's SW cannot reach it. If you just delete `deploy-pages.yml`, those users keep being served the old app from their SW cache indefinitely. Ship one **final** GitHub Pages build whose `index.html` does nothing but:

```js
navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister())))
  .then(() => caches.keys()).then(ks => Promise.all(ks.map(k => caches.delete(k))))
  .then(() => location.replace("https://free-steam-games.win/"));
```

Leave it up for a release cycle, then delete the workflow.

Also: `HashRouter → BrowserRouter` changes every deep link from `/#/games/730` to `/games/730`. The old hash URLs still resolve (the fragment is simply ignored, landing on `/`), so add a tiny bootstrap in `main.tsx` that rewrites `location.hash` starting with `#/` into a `history.replaceState` before the router mounts. Otherwise every bookmark and every link in `games/*.md` lands on the Dashboard.

### (c) Client — `web/src/lib/cache.ts`, `web/src/hooks/useGames.ts`

Today (`cache.ts:7-8`) the entire catalog is one IndexedDB value under `f2p:records`, invalidated wholesale by `isCacheFresh` comparing `index.last_updated` (`cache.ts:43-45`). Because a daily cron rewrites `index.json`, **every user re-downloads and re-parses the entire catalog every single day**, even when one game changed.

Change to per-shard keys, keyed by the shard's content hash:

```ts
const shardKey = (name: string, sha: string) => `f2p:shard:${name}:${sha}`;
```

`loadAll` (`useGames.ts:17-39`) becomes: fetch `index.json` → for each entry, read `f2p:shard:<name>:<sha>` from IDB; on a hit skip the network entirely, on a miss fetch + parse + store; then delete any `f2p:shard:*` key not in the current index. Typical daily delta = 1 changed shard ≈ **166 KB brotli instead of 1,002 KB gzip**.

Two further fixes in the same function:
- `useGames.ts:18-19` awaits `readCache()` *before* `fetchIndex()`, serializing an IDB round-trip in front of the network. Fire both with `Promise.all` — the IDB read does not depend on the index.
- `useGames.ts:29-33` does `Promise.all` over all shards' `.text()` and *then* `Promise.all` over parsing. That materializes 6 MB of strings plus 3,424 parsed objects simultaneously. Pipeline it per shard: fetch → parse → store, so peak memory is one shard.

**`cache: "no-store"` (`fetcher.ts:24` and `:38`, plus `hooks/useRemovedGames.ts:59`):**

| fetch | now | change to | why |
|---|---|---|---|
| `data/index.json` | `no-store` | **`no-cache`** | `no-store` forces a full body download; `no-cache` sends `If-None-Match` and gets a 304 with an empty body. The document is 167 B gzipped so the win is a round-trip's worth of bytes, not a category change — but it costs nothing. |
| `data/data_*.jsonl` | `no-store` | **`default`** (i.e. remove the option) | Once filenames carry `<sha8>`, `no-store` is strictly harmful: it defeats the HTTP cache, the SW, *and* the edge for a file that is immutable by construction. |
| `scripts/removed_games.jsonl` | `no-store` | `no-cache` | Not content-addressed; conditional revalidation is right. |

---

## 3. The cost decision

### Pricing model (from the brief; **I could not verify live from this machine**)
5,000 unique transformations/month free; beyond that an Images Paid plan at $0.50 per 1,000 unique transformations/month. A "unique transformation" = one distinct (source image, option set) pair, counted once per calendar month, resetting monthly. **Two things I flag as unverified:** (i) whether Images Paid bills *all* usage or only the overage above 5,000, and (ii) whether Images Paid carries a plan minimum on top of usage. Both shift the small numbers below; neither changes the ranking.

### The math

Catalog: 3,423 games with a non-empty `header_image`.

| design | uniques/month | monthly cost @ $0.50/1k (all-usage) |
|---|---|---|
| **A** — transform everything, 4 variants (t, t2x, d, d2x) | 13,692 | **$6.85** |
| **B** — transform everything, 2 variants (t@184, d@460) | 6,846 | **$3.42** |
| **C** — hybrid (recommended): Tier A passthrough for flat paths, transform only hashed thumbs + on-demand detail | 1,620 + *(distinct games opened)* | **$0** while opens < 3,380/mo |
| **D** — pre-generate in the Python pipeline → R2 | **0** | **$0** (R2 storage/ops, below) |

**Design C in detail.** 1,803 games sit at flat paths where `capsule_184x69.jpg` genuinely exists (200/6,568 B verified) — those go through Tier A: a plain cached proxy, no transformation. 1,620 games sit at hashed paths where *no* capsule variant exists (4/4 sampled 404) — those must be transformed or you ship 34 KB into a 64×32 slot.

- Floor: **1,620 uniques/month** (thumb, webp) if the whole catalog is scrolled.
- Detail hero: one unique per *distinct game opened per month*. Headroom before the free tier: `5,000 − 1,620 = 3,380` distinct games/month. At `d`+`d2` it halves to 1,690.
- Worst case (every game's detail opened at both densities): `1,620 + 6,846 = 8,466` → **$4.23/mo**.

**Byte impact of C** (full 3,423-thumbnail scroll):

| | bytes | requests |
|---|---|---|
| today | **68.8 MB** | 5,043 (1,620 wasted 404s) |
| design C | **17.0 MB** | 3,423 |
| design B (transform all thumbs) | **9.6 MB** | 3,423 |

C is a **4.1× reduction** and removes 1,620 wasted round-trips for $0. B is 7.2× for ~$3.42/mo.

**Design D — the escape hatch.** Do the resize in `scripts/` with Pillow (`Image.thumbnail` → `save(format="WEBP", quality=75)`), upload to R2 from the existing Actions runner, serve R2 through the Worker. Storage: `3,423 × (2.8 + 11.1 + 20.6 KB)` ≈ **118 MB**, against R2's 10 GB free tier. Backfill writes: 10,269 Class-A ops against 1M/month free. Egress: $0. So D is genuinely $0/month with zero Cloudflare transformation exposure, at the cost of ~120 lines of pipeline code and 3,423 image downloads (~116 MB) in a monthly Action.

### Recommendation

**Ship C. Instrument it. Move to D only if the transformation counter approaches the cap.**

C is the right first move because it is a pure Worker change with no pipeline work, it makes the *large* win (4.1× bytes, and the 47%-of-catalog 404 bug disappears) immediately, and the cost is structurally bounded by the appid allowlist in §1.3 — without that allowlist, none of these numbers hold, because a scraper can point `/img/d2/<anything>` at 200,000 Steam apps and generate an unbounded bill.

Hard guards to ship with C:
1. Appid allowlist (§1.3) — non-negotiable.
2. Variant enum, not free-form `w=`.
3. `format: "webp"` pinned, never `auto`.
4. `?t=` restricted to `^\d{1,12}$`, silently dropped otherwise, so query strings can't fragment the cache.
5. A Cloudflare **Notification** on Images usage at 4,000/month, so you learn about D's necessity from an email rather than an invoice.

**Do not keep weserv as a runtime fallback.** It is the `onError` chain's job to fall back, and it already falls back to the *original Steam URL* (`GameDetailDrawer.tsx:114-117`), which always works. Keeping a second third-party proxy re-introduces the exact privacy claim that `docs/PRIVACY_POLICY.md` and `docs/EULA.md` make and that this migration is trying to keep true.

---

## 4. Loading performance: the JSONL payload

### What it actually costs

| | raw | gzip | brotli-11 |
|---|---|---|---|
| 5 shards as stored (pretty JSON) | 6,063,904 | **1,001,569** *(today's wire cost)* | 690,400 |
| minified JSON, one line per record | 5,660,014 | 969,060 | **639,006** |

So the honest baseline is **~1.0 MB on the wire, not 5.9 MB**. Brotli-11 at the edge takes it to 639 KB — a 36% cut, worth having, but not the story.

### The story: half the payload is not needed to paint

Per-field uncompressed cost, measured across all 3,424 records:

| field | bytes | share | who reads it |
|---|---|---|---|
| `language_details` | 1,446,877 | **24.1%** | `charts/LanguagesHeatmap.tsx:18` and `lib/export.ts:38` **only** |
| `tags` | 802,927 | 13.3% | `charts/TagsWordCloud.tsx:18`, detail drawer, Fuse search |
| `description` | 751,809 | 12.5% | detail drawer `GameDetailDrawer.tsx:169`, Fuse search |
| `header_image` | 471,668 | 7.8% | all four image consumers |
| everything else | 2,187,993 | 42.3% | |

The 13 columns rendered by the games table (`columns.tsx:25-200`: thumb, issues, name, genre, type_game, reviews, current_players, anti_cheat, platforms, release_date, status, link) plus the Dashboard KPIs need **none** of the top three.

| projection | raw | gzip-9 | brotli-11 |
|---|---|---|---|
| full (minified) | 5,660,014 | 969,060 | 639,006 |
| − `language_details` | 4,358,025 | 883,213 | 606,906 |
| − `language_details` − `description` | 3,579,835 | 499,755 | 345,197 |
| **CORE (table + dashboard fields only)** | 1,989,637 | 223,349 | **166,813** |
| DETAIL tail (the rest, keyed by `link`) | 2,338,177 | 157,236 | 101,644 |

**166 KB brotli for everything needed to paint the Dashboard and the full games table.** That is a **6.0× reduction** against today's 1,002 KB, and CORE+DETAIL together (≈639 KB) cost essentially the same total as the unsplit payload — the split is nearly free in bytes and moves 470 KB entirely off the critical path.

### Options evaluated

| option | verdict |
|---|---|
| **keep `raw.githubusercontent.com`** | Cross-origin (extra DNS+TLS at `index.html:11`), gzip-only, `max-age=300`, rate-limited, and it keeps a GitHub dependency in the hot path of a site you are moving to Cloudflare. **No.** |
| **R2** | Works, but adds a moving part and a bucket to keep in sync with Git for data that is already ~6 MB and already in the repo. Reserve R2 for pre-generated images (design D). **Not for JSONL.** |
| **Worker static assets** | `data/` ships in `dist/`, same origin (no extra handshake), brotli at the edge automatically, edge-cached, and — critically — versioned by the same Git commit as the code that parses it, so a schema change and its data can never skew. **Yes.** |

Cost of putting `data/` in `dist/`: 6 MB of static assets. Well within Workers Static Assets limits, and it makes the deploy atomic. The Vite build just needs `publicDir` to include a copy of `../data` (or a tiny `copy` step in `beforeBuild`).

### Recommendation

**Serve `data/` from the Worker's static assets, content-addressed, split CORE/DETAIL.**

Pipeline changes (`scripts/core/data_store.py:158-174`):
```python
index = {
  "max_per_file": MAX_RECORDS_PER_FILE,
  "total": ...,
  "last_updated": now_iso(),
  "core":   [{"name": f"core_{i:03d}.{sha8}.jsonl",   "count": n, "sha": sha8}, ...],
  "detail": [{"name": f"detail_{i:03d}.{sha8}.jsonl", "count": n, "sha": sha8}, ...],
}
```
Keep `data/data_*.jsonl` unchanged as the canonical Git source of truth — CORE/DETAIL are *derived build artifacts*, generated at build time or by a pipeline step, so the write path in `web/src/lib/git-data.ts` and the Python scripts are untouched.

Changes to `web/src/lib/fetcher.ts`:

1. **`RAW_BASE` (line 15) is deleted.** `rawUrl()` becomes `dataUrl(p) => \`/data/${p}\`` — same origin. `hooks/useRemovedGames.ts:57` still needs a GitHub URL for `scripts/removed_games.jsonl`; either copy that into `dist/data/` too (preferred) or keep one `rawUrl` for it.
2. **`fetchIndex` (lines 21-30):** `cache: "no-store"` → `cache: "no-cache"`.
3. **`fetchShardText` (lines 32-44):** drop the `cache` option entirely; add a `fetchCoreShards` / `fetchDetailShards` pair.
4. **`parseJsonl` (lines 47-61) gains a streaming sibling.** Today `useGames.ts:30` does `res.text()` then `worker-pool.parseShard(text)` postMessages a 1.4 MB string. Replace with a transferable stream so parsing overlaps the download:
   ```ts
   const res = await fetch(dataUrl(name));
   const stream = res.body!;                    // ReadableStream
   worker.postMessage({ id, stream }, [stream]); // transferable
   ```
   In `web/src/workers/jsonl-parser.ts`, pipe through `TextDecoderStream` and split on `\n` incrementally. Rank this **third** — it is a TBT/memory win, not a bytes win, and the 166 KB CORE shard barely benefits. It matters for the 470 KB DETAIL fetch.
5. While you are in `jsonl-parser.ts`: **line 13 is the open CodeQL alert** (`js/missing-origin-check`). A dedicated module worker only ever receives messages from its creator, so the alert is low-severity, but the fix is one guard — validate `e.data` shape (`typeof e.data?.id === "number"` and the payload is a string or `ReadableStream`) and bail otherwise. Adding the streaming branch is the natural moment to do it.

Resulting first-load waterfall: `index.json` (167 B, 304 on repeat) → `core_*.jsonl` (**166 KB brotli**, immutable, edge-cached, SW-cached) → paint. DETAIL is fetched when `/charts/languages`, `/charts/tags`, or a detail drawer needs it.

**One caveat to design around:** `GamesTable.tsx:50-57` builds a Fuse index over `["name","description","tags","developer","publisher"]`. `description` and `tags` live in DETAIL. Ship a two-stage search: build Fuse on `["name","developer","publisher"]` from CORE immediately (search works instantly), and rebuild with the full key set once DETAIL resolves. As a bonus this makes the *initial* Fuse index far cheaper — right now it indexes 750 KB of description text synchronously on the main thread the moment `/games` mounts, which is a prime TBT suspect. **I did not measure that index-build cost; profile it before and after.**

---

## 5. Core Web Vitals — specific to this app

**LCP.** The Dashboard returns `<LoadingState />` until data resolves (`pages/Dashboard.tsx:17-19`), so LCP is gated on the *entire* data fetch. The chain today is six deep:

`index.html` → `main.js` → **`initI18n()` awaited** (`main.tsx:64-66`) → `ConsentGate` → `useGames` → `index.json` → 5×shard → worker parse → charts mount → **echarts chunk (~666 KB) downloads**.

1. **Cut the data hop from ~1,002 KB to 166 KB** (§4). Largest single LCP win available.
2. **Preload the critical pair** in `index.html`:
   ```html
   <link rel="preload" href="/data/index.json" as="fetch" crossorigin>
   <link rel="modulepreload" href="/assets/echarts-[hash].js">
   ```
   The `modulepreload` is the important one: ECharts is correctly lazy (`LazyEChart.tsx:11-13`) but its download currently *begins* only after data resolves and the charts mount — the two biggest transfers are serialized when they could be parallel. On the Dashboard route specifically, start the echarts fetch at parse time. (The shard URLs are hash-named, so they can't be statically preloaded; `index.json` can, and it unblocks them.)
3. **`initI18n()` blocks the very first paint** (`main.tsx:64-66`). The comment is right that `t()` must not flash raw keys, but the fix is to bundle the *default namespace* synchronously and lazy-load only additional locales — then render immediately. Today every user, including English ones, waits on an i18n promise before React mounts.
4. **`ConsentGate` (`main.tsx:31`) blocks everything** including data fetching. Kick off the `useGames` query *behind* the gate (prefetch via `queryClient.prefetchQuery`) so the catalog is downloading while the user reads the checkbox. Same for the new welcome page — that screen is free network time.

**CLS.** Already good and worth not regressing: all four image sites set explicit `width`/`height` (`columns.tsx:37-38`, `MobileGameCards.tsx:96-97`, `CommandPalette.tsx:213-214`, `GameDetailDrawer.tsx:111-112`) and `LazyEChart` renders a fixed-height skeleton (`LazyEChart.tsx:23-24`). Two notes:
- Update the `width`/`height` attributes to the *served* variant (`184×69` for `t`, `460×215` for `d`) so the intrinsic ratio matches. `columns.tsx` currently declares `92×43` (ratio 2.14) inside a `h-8 w-16` box (ratio 2.0) — harmless under `object-cover`, but it will lie to any future `aspect-ratio` layout.
- Add `srcset`/`sizes` only on the detail hero (`GameDetailDrawer.tsx:106`): `srcset="/img/d/... 460w, /img/d2/... 920w" sizes="(max-width: 640px) 100vw, 460px"`. Do **not** add `srcset` to thumbnails — that is the §3 cost decision.

**Image hints.** `loading="lazy" decoding="async"` are already on all four (`columns.tsx:33-34` etc.), which is correct for a virtualized list. Two additions:
- The detail-drawer hero should be `loading="eager" fetchpriority="high"` — it is the LCP element of that view and lazy-loading it delays it by a frame. `GameDetailDrawer.tsx:107` currently says `loading="lazy"`.
- Consider raising `overscan` on `GamesTable.tsx:104` (currently 12 @ `estimateSize: 44`) only if you also measure it; more overscan = smoother scroll but more image requests in flight. Leave it alone until you have a scroll trace.

**Preconnect** (`index.html:11-12`) after the origin change:
- **Delete** `<link rel="preconnect" href="https://raw.githubusercontent.com" crossorigin>` — no longer used at load.
- **Delete** `<link rel="preconnect" href="https://shared.akamai.steamstatic.com">` — with `/img/*` same-origin, this connection is now only opened on an `onError` fallback, i.e. never on a healthy load. A preconnect that goes unused costs a wasted socket and, on the akamai host specifically, a wasted TLS handshake.
- **Add nothing.** Every load-critical resource is same-origin. That is the whole point of the migration. (If you keep `api.github.com` calls on the owner path, `preconnect` it from `/settings` only, not globally.)

**Fonts.** Nothing to fix — there are no web fonts. But `web/tailwind.config.ts:50-52` declares `Inter` and `JetBrains Mono` as the primary families and nothing loads them, so the design intent silently degrades to `system-ui` for 100% of users. Either drop the names from the config (honest) or self-host `Inter` as a subset woff2 from `/fonts/` with `font-display: swap` and a `<link rel="preload" as="font" crossorigin>` (and *then* the `woff2` in `globPatterns` at `vite.config.ts:64` starts earning its place). Do not add a `fonts.googleapis.com` link — it re-adds a third-party origin and a render-blocking stylesheet to a site you are consolidating onto one origin.

**INP.** Two candidates, both worth profiling rather than guessing:
- The Fuse index build at `GamesTable.tsx:50-57` (see §4).
- `useGames.ts:32` parses all five shards through the worker pool concurrently; the results then cross the postMessage boundary as 3,424 structured-cloned objects in one burst, plus `writeCache` (`cache.ts:28-37`) structured-clones the same 3,424 objects into IndexedDB. Per-shard IDB keys (§2c) turn one 6 MB clone into five ~1.2 MB ones and, on a typical day, skips four of them entirely.

---

## Open items I could not verify from here

- **Cloudflare Images Paid billing shape** — all-usage vs overage-only, and whether a plan minimum applies. This shifts §3's dollar figures (not the ranking).
- **Whether Workers Static Assets honours a `_headers` file** in its current form. If it does not, move those paths into `run_worker_first` and set the headers in Worker code — the design is unchanged, only the mechanism.
- **`free-steam-games.win` does not resolve from this machine** (consistent with the brief). Everything origin-dependent above — `caches.default` behaviour, image transformations being enabled on the zone (a per-zone dashboard toggle, *not* automatic), `run_worker_first` matching — needs a live smoke test on the real zone, not `*.workers.dev`, where `caches.default` is a silent no-op.
- **`cf.image` is ignored by `wrangler dev` in local mode.** Test transformations with `wrangler dev --remote` or you will conclude the code is broken.
- **Fuse index build cost and the postMessage/IDB clone cost** are reasoned about, not measured. Profile before and after.

## Files this design touches

`E:\2\web\src\lib\image.ts` · `E:\2\web\src\lib\fetcher.ts` · `E:\2\web\src\lib\cache.ts` · `E:\2\web\src\hooks\useGames.ts` · `E:\2\web\src\hooks\useRemovedGames.ts` · `E:\2\web\src\workers\jsonl-parser.ts` · `E:\2\web\src\components\games\table\columns.tsx` · `E:\2\web\src\components\games\table\MobileGameCards.tsx` · `E:\2\web\src\components\games\GameDetailDrawer.tsx` · `E:\2\web\src\components\common\CommandPalette.tsx` · `E:\2\web\src\components\games\GamesTable.tsx` · `E:\2\web\src\main.tsx` · `E:\2\web\vite.config.ts` · `E:\2\web\index.html` · `E:\2\web\tailwind.config.ts` · `E:\2\web\src-tauri\tauri.conf.json` · `E:\2\scripts\core\data_store.py` (`_save_index`, lines 158-174) · new: `E:\2\wrangler.jsonc`, `E:\2\web\worker\index.ts`, `E:\2\web\public\_headers`, `E:\2\web\public\sw-cleanup.js`, `E:\2\web\public\appids.bin` · delete: `E:\2\web\public\404.html`