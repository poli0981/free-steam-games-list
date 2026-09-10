## Contradictions across the seven designs

Verified against `E:\2` where adjudication was possible. Numbers I re-ran myself: akamai **1,927** / fastly **1,496**, hashed-path (40-hex dir) **1,620**, non-`header.jpg` filenames **214**, `LEGAL_DOCS` = **7** entries / **5** with `consent:true`, image consumers = **4** files.

---

# A. Mutually-breaking architecture conflicts

### A1. `wrangler.jsonc` location and Worker entry path — three incompatible answers

| Design | File location | `main` | `assets.directory` | Workers Builds root |
|---|---|---|---|---|
| **cloudflare-platform** | `web/wrangler.jsonc` | `./worker/index.ts` | `./dist` | `web` |
| **images-caching** | `E:\2\wrangler.jsonc` (repo root, per its file list) | `worker/index.ts` | `./dist` | unstated |
| **admin-d1** | `/wrangler.jsonc` (repo root) | `workers/api/src/index.ts` | `web/dist` | repo root |

cloudflare-platform: *"**Do not** put `wrangler.jsonc` at the repo root; that would force `"main": "./web/worker/index.ts"`, `"directory": "./web/dist"`, a `cd web &&` build command, and would break dependency auto-install."*

admin-d1 requires the opposite and knows it: *"provided **Workers Builds' root directory is the repo root** so both `web/` and `workers/` exist in the build context. That's a hard constraint on the hosting workstream's Workers Builds configuration"* — and lists it as open item 6.

**images-caching is simply broken as written**: its config is at `E:\2\wrangler.jsonc` but declares `"main": "worker/index.ts"` and `"directory": "./dist"`, which resolve to `E:\2\worker\index.ts` and `E:\2\dist` — neither exists. Its own files list says the Worker is at `E:\2\web\worker\index.ts`.

**Resolution — cloudflare-platform is right, with one amendment.** There is no root `package.json` in this repo (verified), so Workers Builds' package-manager auto-detection needs root = `web`. Put the file at `web/wrangler.jsonc`, Worker at `web/worker/`. admin-d1's only reason for root was sharing `web/src/lib/git-data.ts` with `workers/` — that's solved by moving the shared modules into `web/src/shared/` and importing them from `web/worker/`, which keeps one build root. admin-d1's `workers/api/src/**` tree must be re-homed to `web/worker/**`; its `migrations_dir: workers/api/migrations` becomes `./worker/migrations` (which is what cloudflare-platform already writes).

### A2. Where the SPA fetches `data/*.jsonl` — three answers, and two of them silently break each other

- **cloudflare-platform**: Worker proxies GitHub. *"`handleIndex` — fetch `https://raw.githubusercontent.com/.../data/index.json`… Respond `Cache-Control: public, max-age=30, s-maxage=60`"*, routes at `/api/data/*`. And critically: *"**A data-only commit will explicitly NOT redeploy.** That is correct and intentional"* with build watch `Include: web/*`.
- **images-caching**: data ships **inside the bundle**. *"Serve `data/` from the Worker's static assets, content-addressed, split CORE/DETAIL… The Vite build just needs `publicDir` to include a copy of `../data`"*, routes at `/data/*`, `RAW_BASE` deleted.
- **admin-d1**: data stays on GitHub. *"have the SPA append `?v=<epoch>` to shard fetches. That defeats the 5-minute Fastly TTL on `raw.githubusercontent.com`"*.

**This is the single most destructive conflict in the set.** images-caching's design only works if a data commit triggers a rebuild. cloudflare-platform explicitly configures build watch paths so it doesn't — and **ci-automation independently mandates the same exclusion**: *"the Worker's build watch paths must exclude `data/**`, `games/**` and `data/snapshots/**`, or you will rebuild and redeploy the SPA 30+ times a month."* If ci-automation's and cloudflare-platform's watch paths land, images-caching's `/data/*.jsonl` static assets go stale the moment the pipeline commits, forever, with no error anywhere.

**Also note images-caching's own numbers argue against it**: it measured the wire cost at **1,002 KB gzip, not 5.9 MB** — so the "put it in the bundle" motivation is much weaker than its framing suggests. Its genuinely valuable findings (content-addressed shard names, CORE/DETAIL split, per-shard IndexedDB keys, `no-store` → `default`) are all **orthogonal to the transport** and work fine through cloudflare-platform's `/api/data/*` proxy.

**Resolution**: keep cloudflare-platform's `/api/data/*` proxy (it preserves the daily-commit-without-rebuild property that both hosting and CI designs depend on), and layer images-caching's content-addressing on top of it. Then `DATA_SHARD_TTL` can go to a year instead of 300 s, and admin-d1's cache-purge-on-commit problem disappears. **Reject admin-d1's `?v=<epoch>`** — a query param on a content-addressed URL fragments both `caches.default` and the Workbox `CacheFirst` entry that images-caching's design depends on; the sha8 in the filename already does the job.

### A3. `run_worker_first` — no two designs list the same prefixes

| Design | Value |
|---|---|
| cloudflare-platform | `["/api/*", "/img/*"]` |
| images-caching | `["/img/*", "/api/*"]` |
| admin-d1 | `["/api/*", "/admin", "/admin/*"]` — **no `/img/*`** |
| deps-security | adds `/assets/*` |

Two independent silent-breakage paths:

1. **admin-d1's list omits `/img/*`.** images-caching states the consequence exactly: *"`/img/*` **must** be in `run_worker_first`. Without it, static-asset matching runs first, misses, and `single-page-application` fallback returns `index.html` with `Content-Type: text/html` as an `<img>` source — every image silently breaks."* Correct.
2. **cloudflare-platform's and images-caching's lists omit `/admin`.** admin-d1 states that consequence exactly: *"With `not_found_handling: "single-page-application"`, an unmatched `/admin/anything` would otherwise fall back to the **public** `index.html`."* Correct — and worse, that would serve the public shell where an operator expects the Access-gated admin entry.
3. **deps-security's `/assets/*` addition contradicts cloudflare-platform on two counts.** cloudflare-platform: *"because "/" is not in this list… Everything else — /, /games/123, /assets/*.js — is served straight from the asset server, which is free and unbilled."* And its own `_headers` note: *"`_headers` does not apply to Worker-generated responses."* So routing `/assets/*` through the Worker (a) makes every JS/CSS request a billed invocation and (b) drops the `Cache-Control: public, max-age=31536000, immutable` header on fingerprinted assets unless re-added in code.

**Resolution**: `["/api/*", "/img/*", "/admin", "/admin/*"]`. Do **not** add `/assets/*`; deps-security's underlying finding (below, C7) is real but has a cheaper fix.

### A4. The D1 "new games queue" means two incompatible things

- **admin-d1**: the queue holds **candidates that are not yet in Git**. New `scripts/discover_new.py` walks Steam `GetAppList`, health-checks the delta, POSTs candidates; admin approves; *"on approve → commit to `scripts/temp_info.jsonl` → push triggers `ingest-new.yml`"*. Endpoint `POST /api/ingest/candidates`, table `ingest_queue`, statuses `pending|deferred|approved|committed|rejected|failed`.
- **ci-automation**: the queue holds **games already committed to Git**. *"new games = records whose `added_at` is within the last N hours"*, published by a workflow step that *"Runs ONLY after the commit succeeded"*, endpoint `POST /api/admin/queue/ingest`, table `queue_new_games`.

Under ci-automation's model **the approve button has nothing to approve** — the record is already in `data/*.jsonl` and already live on the site. Under admin-d1's model ci-automation's hourly reconciler would mark everything `committed` on arrival.

They also disagree on every interface detail: endpoint path, table name, auth (admin-d1 layers Access service token **plus** HMAC-SHA256 over the body with a 300 s window; ci-automation uses the Access service token alone), Access application scope (`/api/ingest/*` vs `/api/admin/queue/*`), and Worker cron cadence (admin-d1 `"triggers": {"crons": ["10 0 * * *"]}` daily; ci-automation hourly).

**Resolution**: admin-d1's is the design the brief asked for ("the daily 'new games' queue that only admin sees… Admin approves → a Worker commits to Git"). ci-automation's §8 is a *post-commit notification feed*, which is a different, also-useful thing — but it must not be called the same queue or write the same table. Note admin-d1's genuine finding that ci-automation missed: **there is no discovery step in `scripts/` today** (`grep -rn "applist\|GetAppList" scripts/` is empty), so ci-automation's `added_at`-window export is the only thing that works *without new Python*, and admin-d1's model requires ~200 lines of new discovery code first.

Also note admin-d1's dependency is real: the approve→ingest loop is dead until `ingest-new.yml:18` stops using the expired PAT. ci-automation fixes that (§1.5).

### A5. Admin auth — Access-only vs. PAT-and-GPG-retained

**admin-d1** deletes the browser credential model outright: *"`web/src/stores/auth.ts` (108 lines) — **Deleted.** With it, `f2p:gh_token` / `f2p:gh_user`"*, `useCommitContext` deleted, `oauth-device.ts` deleted, and: *"Ship a one-time purge on app boot (`main.tsx`, before render) that removes `f2p:gh_token`, `f2p:gh_user`, `f2p:gpg_armored`…"*

**cloudflare-platform** assumes both survive and instructs the owner to carry them across origins: *"**Before the tombstone deploy**, the owner must export the armored key from `poli0981.github.io` and re-import it on `free-steam-games.win`, and re-paste the PAT."* And on signing: *"GPG signing stays client-side; the Worker path produces unsigned commits unless you also move the key server-side (do not…)"*.

That is a direct operational contradiction: cloudflare-platform's migration step 2 ("Owner exports the GPG key and PAT") is undone by admin-d1's boot-time purge.

Two more designs are entangled:
- **ui-welcome** keeps the whole owner path in the public app: *"`/add` stays owner-gated — `Sidebar.tsx:106` already filters on `useIsOwner()`"*, and adds a *"Lock GPG key"* command-palette action. admin-d1 deletes `useIsOwner`, removes the `/add` sidebar entry entirely, and moves `Add`, `EditGameDrawer`, `BulkEditDrawer` into **a second Vite entry** (`web/admin.html` → `dist/admin/index.html`) that the public bundle never references. ui-welcome's component-restyle work on `dialog.tsx`/`sheet.tsx` for "the edit/detail drawers" is scoped against the wrong bundle if admin-d1 lands.
- **deps-security**'s web CSP keeps `connect-src … https://api.github.com https://github.com` and its Tauri CSP justifies `github.com` for *"the device flow hits `github.com/login/device/code`"* — both unnecessary under admin-d1, and `github.com` in `connect-src` is exactly the kind of allowance you want gone.

**Resolution**: admin-d1's model is correct and the brief's decision #3 implies it (a Worker with `contents:write` standing behind a client-side-only ownership check is not defensible). Consequences that must propagate: cloudflare-platform §6.3 loses the "re-paste the PAT" step (replace with "revoke the PAT on GitHub"); cloudflare-platform §2.5's "unsigned commits" is superseded by admin-d1 §3.5 Option A (GraphQL `createCommitOnBranch`); ui-welcome drops `useIsOwner` from the sidebar and palette; deps-security trims `github.com` and `api.github.com` from both CSPs.

### A6. Image URL scheme — two incompatible rewrites of `web/src/lib/image.ts`

| | cloudflare-platform | images-caching |
|---|---|---|
| URL | `/img/{width}/{hostToken}/{steamPath}?t=` | `/img/{variant}/{appid}[/{40hex}]/{asset}.jpg?t=` |
| widths | `{184, 460}` | `t`=184, `d`=460, `d2`=920 |
| host | in the URL (`a`/`f`) | dropped; akamai first, fastly on 404 |
| format | `format: "auto"` | *"**Pin `format: "webp"`, do not use `format: "auto"`.** `auto` emits AVIF… each distinct option set is a distinct billable unique transformation"* |
| abuse guard | regex on path shape | regex **plus** a 13.7 KB sorted `appids.bin` allowlist |
| upstream failure | `302` to the original Steam URL | `502` with `max-age=60` |

**images-caching wins on substance and I verified the decisive fact.** cloudflare-platform's cost model rests on: *"The design above transforms **only width 460**… Width 184 is a filename swap + passthrough → **0 transformations**."* That is false for **1,620 of 3,424 records** (47.3%, verified) — the hashed-path records where `capsule_184x69.jpg` does not exist. cloudflare-platform half-notices this (its 214 `header_alt_assets_*` count is also verified correct) but treats it as a fallback edge case rather than half the catalog. images-caching's Tier A / Tier B split is the correct structure, and its `appids.bin` allowlist is the guard that actually bounds the bill — cloudflare-platform's path regex still lets anyone transform any of Steam's ~200k appids on your account.

**Adopt images-caching's scheme.** Keep from cloudflare-platform: the `IMG_TRANSFORM` kill-switch var (useful for day-1 rollout) and the observation that `format: "auto"` doubles unique-transformation count — actually that's images-caching's; cloudflare-platform uses `format: "auto"` and should not.

---

# B. Silent-breakage conflicts

### B1. Does Tauri get `BrowserRouter`? Three answers, and the hash shim makes it worse

- **cloudflare-platform** ships a split: `const Router = isTauri() ? HashRouter : BrowserRouter;` — *"a routing regression in a shipped desktop/Android binary is not hotfixable, and hash routing costs the desktop build nothing."*
- **ui-welcome** flips unconditionally: `BrowserRouter ← was HashRouter (main.tsx:29)`, and its own ordering diagram says *"The PWA `start_url` and the Tauri shell both load `/`"*.
- **deps-security**: *"Keep `HashRouter` (still exported in v7) until the hosting track's Cloudflare Worker is live, then flip as a separate one-line commit"* — one line, i.e. unconditional.

Then the shim location conflicts:
- **cloudflare-platform**: external `web/public/hash-shim.js`, loaded before the module script, with `if (window.__TAURI_INTERNALS__) return;` — external *because* its own CSP is `script-src 'self'` with no inline allowance.
- **images-caching**: *"add a tiny bootstrap in `main.tsx` that rewrites `location.hash` starting with `#/` into a `history.replaceState` before the router mounts."*

**The failure mode**: if cloudflare-platform's Tauri split lands and images-caching's `main.tsx` bootstrap lands, the desktop app boots at `#/`, the bootstrap strips the fragment, and `HashRouter` renders nothing. Blank window, in a shipped binary. Conversely, images-caching's `main.tsx` placement runs *after* the module graph loads, so on web it flashes the dashboard before correcting — which is the exact thing cloudflare-platform's blocking external script avoids.

**Resolution**: cloudflare-platform is right on all three points (split router, external shim, `__TAURI_INTERNALS__` guard). Its Tauri-source reasoning is sound but its conclusion — ship the split anyway — is the correct risk call. ui-welcome and deps-security must adopt the ternary.

### B2. ui-welcome's inline bootstrap script vs. two `script-src 'self'` policies

**ui-welcome** requires it: *"**A blocking inline script in `index.html`, before `<div id="root">`** (~10 lines)… **This is the only way to kill the FOUC.** It must be inline — add its `sha256-` to both the new Tauri CSP and the Worker's CSP header."*

Neither policy has a hash slot:
- **cloudflare-platform** `_headers`: `script-src 'self'` — and it deliberately changed `injectRegister: "auto"` → `"script-defer"` *"because `auto` injects an **inline** script that the CSP in §1.3 would block."*
- **deps-security** Tauri CSP: `script-src 'self'`, with the note *"Tauri **auto-augments** this at build time with its own IPC bootstrap nonce, so you do not add `'unsafe-inline'`."*

If ui-welcome's script ships without coordination, it's blocked in both environments and every light-mode user gets the dark flash it was written to prevent — silently, since a blocked inline script produces only a console violation.

**Resolution**: ui-welcome's script must move to an external `web/public/boot.js` and merge with cloudflare-platform's `hash-shim.js` into one small blocking file (theme + lang + hash rewrite, ~500 bytes). A CSP `sha256-` hash is the fragile alternative — any whitespace edit to the script silently re-breaks it, and Tauri's build-time CSP augmentation makes hash management there genuinely awkward.

### B3. `workers_dev` — enabled or disabled?

- **cloudflare-platform**: *"Also the `*.workers.dev` subdomain (`f2p-tracker.<sub>.workers.dev`), which **stays enabled** as the rollback/preview target"*.
- **admin-d1**: `"workers_dev": false,  // ← see failure mode S3` and, in S2: *"A zone-scoped Access application does **not** cover the Worker's `workers.dev` hostname."*

Both designs then independently conclude the Worker must verify the Access JWT itself — cloudflare-platform: *"**Verify it in the Worker even though Access already gates the path** — the `*.workers.dev` hostname is not behind the Access application."* So they agree on the mitigation and disagree on whether to leave the hole open at all.

**Resolution**: `workers_dev: false`. cloudflare-platform's stated benefit (preview URLs) comes from Workers Builds' `versions upload` on non-production branches, which it describes correctly in §5 step 7 — those preview URLs exist independently of `workers_dev`, and admin-d1 correctly flags that they need auditing too.

### B4. `navigateFallbackDenylist` — each design names a different subset

cloudflare-platform: `[/^\/api\//, /^\/img\//]`. admin-d1: `[/^\/admin/, /^\/api\//]` plus *"no runtimeCaching rule may match `/api/*`"*. images-caching: doesn't mention it at all, while adding `/img/*` and `/data/*` SW rules.

Union required: `[/^\/api\//, /^\/img\//, /^\/admin/]`. admin-d1's failure mode is the sharpest: *"Once a visitor's SW is installed, an `/admin` navigation is answered *from cache* with the public shell and never reaches Cloudflare."*

### B5. `f2p-data-v3` — same cache name, different URLs, different strategies

- **cloudflare-platform**: `urlPattern: ({url}) => url.pathname.startsWith("/api/data/")`, `cacheName: "f2p-data-v3"`, strategy unchanged (NetworkFirst).
- **images-caching**: `urlPattern` matches `/data/data_*.jsonl`, `cacheName: "f2p-data-v3"`, **`handler: "CacheFirst"`** — *"NetworkFirst → CacheFirst is now correct, because the shard filename changes when the content changes."*

images-caching's reasoning is sound **only** under content-addressed filenames. If A2 resolves to cloudflare-platform's `/api/data/index.json` transport without the sha8 rename, and someone takes images-caching's `CacheFirst`, `index.json` gets pinned in the SW cache and the app never sees a data update again — the exact bug the existing `f2p-data-v2` comment (`vite.config.ts:71-80`) documents having already been fixed once.

**Resolution**: `CacheFirst` for `/api/data/data_*.<sha8>.jsonl` only; `index.json` stays `NetworkFirst`, in a separately-named cache. Take images-caching's `sw-cleanup.js` legacy purge either way — cloudflare-platform's cache-name bump alone leaves the old entries occupying quota, which images-caching correctly points out (`cleanupOutdatedCaches` only touches precaches).

### B6. `data/index.json` shape is mutated by three designs independently

- **images-caching** (`scripts/core/data_store.py:_save_index`): adds `sha` per shard and replaces `files` with `core[]` + `detail[]` arrays.
- **docs-legal**: adds `license`, `license_url`, `attribution` top-level keys, and warns *"the write path (`web/src/lib/git-data.ts`) rewrites `index.json` on every edit to bump `last_updated` — it must preserve these keys, not reconstruct the object from a template."*
- **admin-d1**: *"Port `bumpedIndexFile()` (`edits.ts:45-66`) **byte-for-byte**, including `JSON.stringify(next, null, 2) + "\n"`… Preserve `max_per_file` and per-shard `count` deltas exactly."*

admin-d1's byte-for-byte port is written against **today's** shape (verified: `max_per_file`, `total`, `last_updated`, `files[{name,count}]`). It survives docs-legal's additive keys only if it spreads unknown keys; it does **not** survive images-caching's `files` → `core`/`detail` restructure, because `bumpedIndexFile` walks `files` to apply count deltas.

**Resolution**: whoever lands first owns the schema. Order it: docs-legal's additive keys → images-caching's `sha` field added to the existing `files[]` entries (not a restructure) → admin-d1's port written last, against the final shape, spreading unknown keys. Reject the `core`/`detail` array restructure in `index.json`; derive those names from `files[].sha` instead.

### B7. Tauri image path: `isTauri()` bypass removed, but two designs still assume it exists

**images-caching**: *"**Remove the `isTauri()` bypass at `image.ts:37`.**… Set `IMG_ORIGIN = "https://free-steam-games.win"` (absolute) so the Tauri webview… resolves it."*

Verified — `web/src/lib/image.ts:36-39` is `if (!url || isTauri()) return url;`.

But:
- **deps-security** builds its Tauri CSP on the bypass surviving: *"`images.weserv.nl` is deliberately absent from the *desktop* CSP. `preferWebp()`… short-circuits with `if (!url || isTauri()) return url;` — the Tauri build **never** calls weserv."*
- **docs-legal** writes it into the Privacy Policy as a published fact: *"**Exception — the desktop and Android apps.** Those load header images directly from `shared.akamai.steamstatic.com`, so Akamai does see your IP there… it is the only place the old behaviour survives."*

If images-caching lands, that Privacy Policy paragraph is false on publication — the exact class of error docs-legal exists to fix.

**Resolution**: images-caching is right on the engineering (the Worker origin is first-party now, so the original privacy rationale is void). docs-legal's paragraph must be deleted, not softened. deps-security's Tauri CSP already lists `https://free-steam-games.win` in `img-src`, so it works either way — but its *reasoning* needs updating, and the two Steam hosts stay in `img-src` for the `onError` fallback (which images-caching correctly keeps).

### B8. docs-legal allowlists one Steam host; 44% of images are on the other

**docs-legal**, twice, as a legal constraint and as a security-scope boundary:
- §1.4: *"allowlist `shared.akamai.steamstatic.com` as the only source origin (which you must do anyway for SSRF)"*
- SECURITY.md draft: *"if you can make the Worker fetch an origin that isn't `shared.akamai.steamstatic.com`, that's a finding"*
- DEPLOYMENT.md outline: *"Source-origin allowlist — shared.akamai.steamstatic.com only."*

Verified: **1,496 records (43.7%) are on `shared.fastly.steamstatic.com`**. Both image designs allowlist both hosts. As written, docs-legal's published security policy would classify normal operation of 44% of the catalog as a vulnerability, and its deployment runbook would break those images.

**Resolution**: docs-legal's allowlist is `{shared.akamai.steamstatic.com, shared.fastly.steamstatic.com}`. Also flag: docs-legal's *"only ever transform **down** to thumbnail/capsule sizes"* constraint sits awkwardly with images-caching's `d2` variant at **920×430** — larger than Steam's own `header.jpg` render size. Either drop `d2` or re-word the constraint to "never larger than the publisher's own header asset."

### B9. docs-legal's image cost claim contradicts both image designs

**docs-legal**: *"3,424 games × ~2 sizes ≈ 6,800 unique transformations on the first full crawl — **the free tier is blown on day one**… the single biggest cost surprise in the migration."*

That is images-caching's **Design B**, which it explicitly rejects. Its recommended **Design C** is `$0` while distinct detail-opens stay under 3,380/month, with a hard floor of 1,620 uniques. cloudflare-platform's number is lower still (and, per A6, understated). docs-legal is writing a cost warning into `DEPLOYMENT.md` for a design nobody chose.

**Resolution**: docs-legal should cite images-caching Design C's actual numbers, including the 5,000-notification threshold and the Design D (pre-generate → R2) escape hatch.

### B10. Description truncation ripples into the data split and search

**docs-legal** recommends truncating `description` to ~180 chars in `scripts/core/fetcher.py`. **images-caching** measured `description` at 751,809 bytes (12.5%) and puts it in the DETAIL shard, and notes `GamesTable.tsx:50-57` builds a Fuse index over `["name","description","tags",…]`.

Not a contradiction, but a dependency nobody flagged in the other direction: truncation shrinks DETAIL by ~40%, which weakens the CORE/DETAIL split's payoff and changes images-caching's brotli table. And docs-legal's own cross-lane appendix correctly identifies the operational hazard — *"a ~3,424-record rewrite… needs to land in one deliberate commit with the `concurrency: { group: data-write }` guard held, and `snapshot-daily.yml` is currently missing that guard"* — which ci-automation fixes in §7.1. Sequence: ci-automation's concurrency fix → truncation commit → images-caching re-measures.

---

# C. Same-file, different-values

### C1. Python version — `.python-version` written twice with different contents

- **ci-automation**: *"**Python → `3.14`**, recorded once in a new `.python-version` file"* — argues plurality + already green in CodeQL.
- **deps-security**: *"**Standardize on 3.12**… (b) `docs/dev_env.md` and `AUTHORS.md` already *claim* 3.12 — picking it makes the docs true for free instead of requiring a doc edit."*

Both propose `python-version-file: '.python-version'` in every workflow. **deps-security's argument is stronger** — docs-legal's contradiction table (#20–#23, #25) has to edit `README.md:222`, `AUTHORS.md:34`, `docs/dev_env.md:19-26`, `docs/i18n/vi/dev_env.md:19-20` and `web/src-tauri/TAURI.md` if you pick 3.14, and zero of them if you pick 3.12. ci-automation's "nothing removed in 3.13/3.14 is touched" verification is equally valid for 3.12. Pick **3.12**; it makes three documents true at no cost.

### C2. `.github/dependabot.yml` — two full files proposed

ci-automation: 4 ecosystems, `interval: weekly, day: tuesday`, one `actions-minor` group. deps-security: 4 ecosystems, `day: monday`, ~10 groups including `applies-to: security-updates`. deps-security's is materially better (the `applies-to: security-updates` grouping collapses 18 alerts into ~2 PRs). But deps-security's version bumps `actions/checkout` toward v7, which ci-automation explicitly forbids for now: *"**Do not stack an untested action-major bump on top of a token migration you need to verify.**"* Merge: deps-security's file plus an `ignore` on `actions/checkout` / `actions/setup-python` majors until ci-automation's PR 1 is verified green.

### C3. Worker identity fields

| Field | cloudflare-platform | images-caching | admin-d1 |
|---|---|---|---|
| `name` | `f2p-tracker` | `free-steam-games` | `f2p-tracker` |
| `compatibility_date` | `2026-09-10` | `2026-09-01` | `2026-09-01` |
| D1 `migrations_dir` | `./worker/migrations` | — | `workers/api/migrations` |
| queue table | `new_game_queue` | — | `ingest_queue` (+ `queue_new_games` in ci-automation) |

The Worker `name` determines the deploy target and the `workers.dev` subdomain — two designs deploying under different names produce two Workers.

### C4. CSP — two policies, two mechanisms, six substantive differences

cloudflare-platform puts it in `web/public/_headers`; deps-security puts it in a Worker response header. Note cloudflare-platform's own caveat: *"`_headers` does not apply to Worker-generated responses"* — so if the CSP lives only in `_headers`, `/api/*` and `/img/*` responses ship without one; if it lives only in Worker code, the static pages (i.e. every page) ship without one. **Both are needed.**

Differences to reconcile:

| Directive | cloudflare-platform | deps-security | Adjudication |
|---|---|---|---|
| `img-src` | `shared.akamai` + `shared.fastly` explicitly | `https://*.steamstatic.com` + **`images.weserv.nl`** | Drop weserv (images-caching deletes it; docs-legal's privacy text depends on it being gone). Wildcard vs. explicit: explicit is tighter. |
| `base-uri` | `'none'` | `'self'` | `'none'` — nothing in the app sets `<base>`. |
| `style-src-attr` | absent | `'unsafe-inline'`, called *"the most common way a 'correct-looking' CSP silently breaks a React app"* | **deps-security is wrong here.** CSP3 falls back to `style-src` when `style-src-attr` is absent, so cloudflare-platform's `style-src 'self' 'unsafe-inline'` already covers `style=""`. Harmless to include, but the stated failure mode doesn't exist. |
| `connect-src` github hosts | `api.github.com` + `github.com` | same | Both should drop `github.com` once admin-d1 removes the device flow (A5). |
| `worker-src` | `'self' blob:` | `'self'` | deps-security verified `worker.format: "es"` → same-origin `.js`, no blob needed. deps-security is right. |
| `frame-ancestors` | `'none'` | `'none'` | Agree. |

### C5. `Cache-Control` on the data index

cloudflare-platform: `public, max-age=30, s-maxage=60, stale-while-revalidate=300`, and *"`cache: "no-store"` … should become `cache: "default"`"*. images-caching: browser `no-cache` + `CDN-Cache-Control: public, max-age=30`, and *"`data/index.json` | `no-store` → **`no-cache`**"*.

**images-caching is right** for the index specifically: at 167 B gzipped, `max-age=30` buys nothing and costs correctness (a commit is invisible for up to 30 s of *browser* cache with no revalidation path); `no-cache` gets a 304 with an empty body. cloudflare-platform's `cache: "default"` advice is right for the **shards**, wrong for the index.

### C6. `web/src/index.css` — two incompatible full rewrites

- **ui-welcome**: a new "Cold Neon" palette (~40 new tokens, `--primary` moves from blue-500 to cyan, `--radius` 0.5rem → **0.625rem**, 8 chart-series tokens, new `--success`/`--warning`/`--info`/`--surface-2`/`--border-strong`/`--shadow-*`), `@theme inline`, `@utility container`, hand-written `animations.css`.
- **deps-security**: *"The 17 raw HSL channel triples stay as PLAIN CSS… **Zero edits here** — the whole `:root` / `.dark` block from lines 6-45 is copied verbatim"*, plain `@theme`, `@utility container`, `tw-animate-css`.

They agree on `@custom-variant dark (&:where(.dark, .dark *))`, on deleting `tailwind.config.ts` and `postcss.config.js`, on `@tailwindcss/vite`, on `tailwind-merge` 2→3, and on the `container` utility break. They conflict on the palette (mechanical migration vs. redesign), on `@theme` vs `@theme inline`, and on the animate plugin.

On `@theme inline`: ui-welcome says *"`inline` is required so the /opacity modifier (`bg-primary/15` at `Sidebar.tsx:86`) resolves via `color-mix()`"*. Over-stated — both forms produce a valid color for `color-mix()`, and both re-resolve correctly under `.dark` because custom-property substitution is per-element. Not a blocker either way; `inline` is the shadcn-v4 convention and is the safer default.

**Resolution**: do deps-security's mechanical migration first (verbatim tokens, so the Tailwind 4 diff is provably visual-neutral and revertable), then ui-welcome's palette as a separate commit — which is exactly ui-welcome's own §6.4 step ordering (5 then 6). Just make sure only one of them writes `index.css` in each commit.

### C7. `isChunkLoadError` and the SPA fallback MIME problem

deps-security found a genuine cross-design break nobody else caught: with `not_found_handling: "single-page-application"`, a deleted hashed chunk returns `index.html` with **HTTP 200**, and the browser error is *"Expected a JavaScript module script but the server responded with a MIME type of text/html"* — which the verified regex at `web/src/lib/lazy.ts:21` (`failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module`) does not match.

cloudflare-platform explicitly assessed the same line and concluded *"**no change needed, but re-verify.** Under BrowserRouter the reload happens at e.g. `/charts/tags`; Cloudflare's SPA fallback returns `index.html` (200)…"* — it spotted the 200 and drew the wrong conclusion. **deps-security is right.** But take only its fix #1 (widen the regex); reject fix #2 (`run_worker_first` on `/assets/*`), per A3.

### C8. `pip install` — two mechanisms for the same 12 sites

ci-automation: *"**remove `pip install` from all eleven `bash/*.sh`** and hoist it into the composite action."* deps-security: *"replace `pip install --quiet requests` with `pip install --quiet -r requirements.txt` in all 10 `bash/*.sh` and the 2 inline workflow steps."*

Mutually exclusive edits to the same 10 files. ci-automation's is cleaner in CI but makes `bash/*.sh` non-self-contained locally; deps-security's keeps them runnable. Also deps-security wants exact `==` pins so its Dependabot `pip` block does anything; ci-automation keeps ranges — deps-security is right that with `>=`/`<3` ranges *"Dependabot has nothing to do and you get silent drift."*

### C9. Audit-log contents — the schema and the published privacy policy disagree

- **admin-d1** schema: `actor TEXT NOT NULL, -- "you@example.com"` (the **Access email**), plus `ip_country TEXT, -- request.cf.country only`, retention *"add a retention cron (365 days)"*.
- **docs-legal** privacy draft: *"Deliberately: **GitHub login**, action, target appid, timestamp. **No IP addresses, no User-Agents, no visitor records.**… Rows older than **180 days** are deleted on a schedule."* And §11: *"D1 audit rows: 180 days."*

Three mismatches in a document that is a legal representation: identity type (Access email vs GitHub login), the undisclosed `ip_country` column, and 180 vs 365 days. Also docs-legal's `ARCHITECTURE.md` outline says *"the fact that there is no backend session anywhere"* while its own Privacy §3 documents the `CF_Authorization` session cookie.

**Resolution**: the schema is the source of truth; the policy must describe it. Either drop `ip_country` (it buys little for a single-admin surface) or disclose it. Pick one retention number and put it in the retention cron and the policy together.

### C10. Health / identity endpoint — three names

cloudflare-platform routes `GET /api/health`. admin-d1 routes `GET /api/admin/me`. ci-automation's canary hits `GET https://free-steam-games.win/api/admin/health` and specifies its response shape (`{ok, pending, newest_first_seen_at}`). Three designs, three paths, and ci-automation's is the one with a scheduled consumer.

---

# D. Factual disputes I adjudicated against the repo

| Claim | Designs | Verdict |
|---|---|---|
| `echarts-for-react` blocks React 19 | ui-welcome: *"Peer is `react ^15\|\|^16\|\|^17\|\|^18` — no React-19 range shipped. `npm ci` will error"* vs deps-security: *"`react: ^15.0.0 \|\| >=16.0.0` ✅ Permissive"* | **deps-security.** Installed 3.0.6, peer is `{"react":"^15.0.0 \|\| >=16.0.0","echarts":"^3 \|\| ^4 \|\| ^5 \|\| ^6"}`. It also already accepts echarts 6. ui-welcome's "drop it, hand-roll 40 lines" is optional cleanup, not a forced migration. |
| echarts lockfile pin | ui-welcome: *"lockfile pinned 5.6.0"* / the brief agrees vs deps-security: *"`package-lock.json` already resolves → **6.1.0**. Only the *local* `node_modules/` is stale"* | **deps-security.** `package-lock.json` → `echarts 6.1.0`; local `node_modules/echarts` → 5.6.0. CI already ships echarts 6. |
| `sonner` needs a major bump for React 19 | ui-welcome: *"`^1.5.0` … 1.5 predates 19; **2.x** supports it. Bump."* vs deps-security: *"1.7.4 already supports 19. Stay on 1.7.4"* | **deps-security.** Installed 1.7.4, peer `^18.0.0 \|\| ^19.0.0`. |
| `zustand` 5 needs source changes | ui-welcome: *"check `stores/auth.ts` for `persist` middleware, which needs `create<T>()(persist(…))`"* vs deps-security: *"a literal zero-source-change bump"* | **deps-security.** `stores/auth.ts` uses a hand-rolled `loadAuth()` at line 26, not `persist`. (Moot if admin-d1 deletes the file.) |
| `cmdk` must be bumped | ui-welcome: *"`^1.0.0` … **Must bump**"* | Installed is already **1.1.1** with `react ^18 \|\| ^19`. No action. |
| `Cargo.lock` exists | deps-security corrects its own briefing | **Confirmed** — `git ls-files web/src-tauri/Cargo.lock` returns it. |
| capsule variant 404s on hashed paths | images-caching (1,620 records) vs cloudflare-platform (treats it as 214 edge cases) | **images-caching.** 1,620 hashed-path records verified; 214 non-`header.jpg` filenames verified separately. cloudflare-platform's "0 transformations at 184w" is wrong for 47% of the catalog. |
| Steam host split | both image designs: 1,927 akamai / 1,496 fastly | **Both correct**, verified. The brief and `vite.config.ts:94-95` are wrong (akamai-only regex → 44% uncached). |
| `LEGAL_DOCS` count | ui-welcome: *"the 7 LEGAL_DOCS from `lib/legal.ts:19`"* | **Correct** — 7 entries, 5 `consent:true`. But docs-legal expands to 11 entries / 6 consent, which makes ui-welcome's welcome-page copy stale on arrival. |
| `image.ts` consumers | brief says 3; both image designs say 4 (CommandPalette missed) | **4**, verified: `columns.tsx:35`, `MobileGameCards.tsx:94`, `CommandPalette.tsx:211` (`headerToCapsule`), `GameDetailDrawer.tsx:109` (`preferWebp`). |

---

# E. Internal contradictions within a single design

- **ci-automation, §3.2 — the composite action will not work as written.** It puts `actions/checkout` *inside* `.github/actions/py-data-job/action.yml`, then says: *"the composite action lives in-repo, so `actions/checkout` must have run for `uses: ./…` to resolve — GitHub handles this by checking out the *action's* repo automatically for local composite actions. This is why the checkout step sits inside the composite: it works."* That is false — a local action referenced as `./.github/actions/…` requires the repository to already be on disk, i.e. `actions/checkout` must run in the **calling job** first. As written, all 11 rewritten workflows (including the snapshot-daily replacement in §7.1) fail at step resolution. Fix: keep `actions/checkout` in the caller, or make it a reusable workflow (`workflow_call`) instead of a composite action.
- **ui-welcome, §3.2 vs §3.3.** §3.2: *"`/charts/anti-cheat/list` **stops being a nav item**… It becomes a `chart | table` tab inside `/charts/anti-cheat`"* and §1.7 redirects it. §3.3: *"**Add the missing routes:** `/top-offline`, `/charts/delisted`, `/charts/anti-cheat/list`, `/donate`, `/welcome`"* to the command palette. Pick one.
- **images-caching, §1.5.** `wrangler.jsonc` paths are relative to the repo root while the file list places the Worker under `web/`. See A1.
- **cloudflare-platform §6.2 vs ci-automation §6 row 7.** cloudflare-platform wants a tombstone Pages deploy left serving for ~30 days as the rollback path; ci-automation's checklist sets **Settings → Pages → Source: None** and deletes the `github-pages` environment, which removes the tombstone. Also cloudflare-platform correctly notes *"GitHub Pages cannot issue a 301"* and uses `location.replace` to carry the deep link, while ci-automation proposes *"a one-line meta-refresh"*, which drops the fragment. Sequence: tombstone deploy → 30 days → Source: None + environment deletion.

---

# F. Welcome page + legal gate — ui-welcome vs docs-legal

Both agree consent comes first. They conflict on three points:

1. **Versioning the welcome flag.** ui-welcome: *"`export const WELCOME_VERSION = 1;` … Bump when the welcome content changes materially (domain move, licence split)"*. docs-legal: *"a plain boolean with **no version number**, deliberately decoupled… Coupling them would make every legal update feel like a factory reset."* These aren't quite the same objection — ui-welcome already decouples from `TERMS_VERSION` — but they produce different stores. ui-welcome's version is the more useful of the two (the welcome page's own content *will* change at the domain move), and it doesn't create the coupling docs-legal fears.
2. **Where legal documents render.** ui-welcome §1.5 §7 uses `legalDocUrl()` + `openExternal()` — GitHub blob links. docs-legal §7.5: *"On Tauri desktop and Android that *ejects the user into a system browser* to read the terms they are being asked to accept… undermines the 'informed' half of informed consent"*, and proposes in-app `/legal/*` routes with a `route` field added to `LegalDoc`. **docs-legal is right**, and its companion catch is load-bearing: `ConsentGate.tsx:30` is verified as `location.pathname.startsWith("/error")` only, so `/legal/*` **must** join the bypass or the documents sit behind the gate that links to them. ui-welcome's §7 "The paperwork" section must link to `/legal/*`, not GitHub.
3. **Doc count.** ui-welcome renders *"the 7 `LEGAL_DOCS`"*; docs-legal grows the list to 11 with 6 consent docs and bumps `TERMS_VERSION` 1 → 2. ui-welcome's copy and layout must be written against the post-split list.

One thing ui-welcome needs from docs-legal that isn't flagged: ui-welcome requires exposing `acceptedAt` from `stores/consent.ts:43` for its "You accepted these on {{date}}" line — docs-legal separately wants the store to **retain the old version number** to distinguish first-run from re-consent. Same file, two additive changes; land together.

---

# G. What all seven agree on (settled — don't re-open)

`base: "/"`; delete `web/public/404.html` and its `globIgnores` entry; `not_found_handling: "single-page-application"`; delete `deploy-pages.yml` **and** `notify-deploy.yml` (cloudflare-platform found the orphan, ci-automation independently confirms); `npm ci || npm install` fallback must go; `f2p-data-v2` cache name must be bumped; the old GitHub Pages service worker needs a self-destructing tombstone or existing visitors never learn the site moved; the Worker must verify the Access JWT itself regardless of Access being in front; `secrets.GH_TOKEN` should be replaced by `secrets.GITHUB_TOKEN` rather than rotated; `og:image` must become a PNG; both Steam hosts must be handled everywhere the akamai-only regex appears today.