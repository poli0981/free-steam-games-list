# CLAUDE.md — free-steam-games-list

Load-bearing facts about this repo. Every claim here was verified against the
code; if you change the code, change this file.

## What this is

A dataset of free-to-play Steam games (`data/data_*.jsonl`) plus a SvelteKit app
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

- **`MANUAL_FIELDS` are human judgements.** They are `anti_cheat`,
  `anti_cheat_note`, `is_kernel_ac`, `notes`, `type_game`, `safe`, `genre`.
  Two mechanisms protect them, and they are not the same thing:

  1. *Fill-if-empty*, in `merge_extension_data()` and `apply_details()`: a
     scrape will not overwrite a non-empty value. This is weak — it cannot
     tell a human correction from earlier scraper output, so
     `normalize_genres.py --apply`, which rewrites `genre` for every game,
     silently reverts corrections.
  2. *Overrides*, below. This is the durable one.

- **`data/overrides/<appid>.json` is human intent, and it is permanent.**
  `apply_overrides()` is called from inside `save_main()` — the single choke
  point through which all 11 data-writing scripts pass, and the only code that
  writes `data/data_*.jsonl`. An override is therefore re-imposed as the last
  act of every write, so it survives `refetch_all.py` and
  `normalize_genres.py --apply` without either script knowing it exists. Add a
  new dataset writer and it inherits this for free — provided it goes through
  `save_main()`, which it must.

  Three rules that are not obvious:
  - **An override may not set a field empty.** The next scrape would refill it
    (fill-if-empty) and this layer would blank it again, flip-flopping shards
    on every run. To clear a field, *retire* the override.
  - **Retiring is not deleting.** Deleting the file leaves the field pinned to
    the human value forever, because fill-if-empty never restores the old one.
    A retired entry keeps `was` and writes it back once, then permanently
    no-ops because the values no longer match.
  - **`notes` is a hybrid field.** The pipeline appends its own segments to it
    (`MACHINE_NOTE_MARKERS`), and those appends are one-way —
    `mark_dead_games.py` only appends while `is_dead` is False, so a stripped
    marker is never re-added. `preserve_machine_notes()` re-attaches them; do
    not bypass it.

- **Shard assignment is unstable.** `save_main()` re-chunks the entire record
  list into 800-record files from scratch on every run and deletes leftovers.
  A game moves between `data_001.jsonl` and `data_005.jsonl` as records before
  it are added or removed. Never persist "game X lives in shard N".

- **`data/index.json` is the client's whole cache contract.** Two fields, both
  computed by `_save_index()` and nothing else:
  - `last_updated` changes **if and only if** a shard's bytes, the shard list
    or the counts changed. A save that changed nothing keeps the old stamp,
    leaves `index.json` byte-identical, and so produces no commit (it used to
    force every visitor to re-download ~6 MB).
  - `files[].sha256` is the hash of each shard's exact committed bytes.
    `save_jsonl` writes with `newline="\n"` so a Windows run hashes the same LF
    bytes Git stores. The client will not cache a shard whose bytes do not
    match its entry, and the Worker caches a shard forever under that hash.

  Commit a shard without going through `save_main()` and every browser keeps
  serving pre-edit records. `scripts/tests/test_index_hash.py` pins both.

- **`index.json` is rebuilt from scratch on every save.** `_save_index()` in
  `scripts/core/data_store.py` writes it from a fixed set of keys, so any key
  added to that file by anything else is silently dropped the next time the
  pipeline runs. Add a key there or not at all.

  (The browser-side `bumpedIndexFile()` that used to have the same flaw is
  gone, along with sign-in and in-app editing. The public app no longer writes
  anything.)

- **`web/src/lib/schema.ts` mirrors `scripts/core/constants.py`.** `MANUAL_FIELDS`,
  `ARRAY_FIELDS`, `EXTENSION_FIELDS` and the record shape exist in both. Change
  one, change the other.

## Pipeline

- `update_data.py` only **enriches existing records**. It does not discover new
  games.
- `ingest_new.py` only reads `scripts/temp_info.jsonl`. It has exactly two
  producers now: the browser extension (`poli0981/steam-f2p-extension`, which
  pushes to the file directly) and the `/admin` approve flow (the Worker
  appends via `createCommitOnBranch`). The issue-template and Telegram paths
  were removed. Both producers APPEND; anything that overwrites this file
  destroys whatever the other queued.
- New games ARE discovered automatically now, by `scripts/discover_new.py`
  into the D1 review queue — but discovery only PROPOSES. Publication stays a
  human decision made in `/admin`.
- **Queue rules live in `web/shared/queue-rules.ts`, imported by the Worker AND
  the admin UI.** A row is read-only when its status is not decidable
  (`approved` = the request is committed to Git, `committed` = the game was
  observed in `data/`, `rejected`) or when its GAME is already published (a
  committed row or an approved decision for the appid — per game, because one
  appid can have several rows). `/api/admin/decide` refuses such rows in its
  read AND in every UPDATE's WHERE, and returns each refused id in `skipped`
  with a reason; it never drops one silently. `queue-rules.test.ts` parses
  `0001_init.sql` so the constants cannot drift from the CHECK constraint or
  `uq_queue_open_appid`.
- **`reconcile.ts` is still the only writer of `ingest_decisions('approved')`,**
  and it now also sweeps: a pending/deferred/failed row whose appid is in
  `data/` becomes `committed`, replacing a stale `rejected` decision. It holds a
  D1 lease (`admin_locks`) and skips the ~6 MB fetch while `data/index.json`'s
  generation is unchanged (`admin_state`). Migration `0002_admin_state.sql` is
  applied by hand, so `lib/locks.ts` treats a missing table as "unavailable" and
  every caller falls back — deploy order must never matter. Keep it that way for
  any future migration a Worker change depends on.
- `audit_log` and `commit_jobs` are pruned daily after `ADMIN_RETENTION_DAYS`
  (wrangler.jsonc, 180). `docs/PRIVACY_POLICY.md` states the number: change
  both together. `ingest_queue` and `ingest_decisions` are never pruned — the
  decisions are what keep a rejected game out of the discovery sweep.
- Every workflow that writes to `data/` shares `concurrency: {group: data-write}`.
  A new data-writing workflow without it will race jobs that run ~2 hours.
- Workflows push with the built-in `GITHUB_TOKEN`; each declares
  `permissions: {contents: write}`. Do not reintroduce a PAT — a PAT expiring
  silently is what stalled the pipeline for a month in 2026.

## Frontend gotchas

- **Never pass a theme name to `echarts.init()`.** `echarts/core` ships no
  registered themes. Under echarts 6 an unregistered theme name silently stops
  every series from painting — axes and legends still draw, so charts look
  "empty" rather than broken, and nothing is logged. Charts set their own colors
  from the design tokens; see `web/src/lib/charts/echarts.ts`.
- **A chart that initialises but paints no canvas looks identical to that bug
  and usually is not.** In Svelte 5 a value an `$effect` must react to has to be
  `$state`: a plain `let chart` meant the setOption effect ran once while it was
  still undefined and never re-ran. See the comment in
  `web/src/lib/charts/EChart.svelte`.
- **zrender's wheel listeners are forced passive during `echarts.init()`.** It
  binds both `wheel` and `mousewheel` with no options object, unconditionally
  and regardless of `dataZoom`, which blocks scrolling over every chart — they
  sit inside the page's scroll container. `EChart.svelte` swaps
  `addEventListener` for exactly the duration of that one call. A passive
  listener cannot `preventDefault()`, so `dataZoom: {type: "inside"}` and
  `roam: true` would silently stop working; `charts.test.ts` fails if either
  appears.
- **Every chart colour must be one zrender can parse, which is stricter than
  what a canvas paints.** zrender splits `hsl()` on commas: space-separated
  `hsl(38 94% 60%)` paints, but every hover state derived from it comes back
  `undefined` and the hovered tile/bar/slice loses its fill; `hsl(var(--x))`
  never paints at all. Take colours from `chartTheme()` (it converts the bare
  channel tokens), never write `var(--…)` in an option, and use `gridBox()`
  rather than `containLabel`, which in echarts 6 leaves axis NAMES out of the
  layout. An option key whose component is not registered in `echarts.ts`
  (`markLine` was) is silently ignored. `chart-colors.test.ts` and
  `charts.test.ts` hold all three.
- **A duplicate key in a keyed `{#each}` THROWS in a production build** — Svelte
  5 does not only warn. The command palette crashed on open because one path
  was in two nav lists, and five records repeat a developer name. Deduplicate
  anything data-derived before keying on it.
- **Use `resource.pending`, never `loading && !data`, to choose between a
  loading state and the page.** `loading` is false before a load starts —
  during prerender and until consent — so the old check prerendered empty
  states ("No game matches these filters.") as page content. Likewise no count
  may be interpolated into a `<Seo>` description: at build time it is 0.
  `web/scripts/verify-dist.mjs` fails CI on either, and on any `{{placeholder}}`
  left in the HTML.
- **i18n keys are literal.** `t(\`detail.${key}\`)` is how a suffix key rendered
  as a field label; `i18n.test.ts` rejects template-literal keys, a literal
  call that omits a `{{variable}}` its text needs, and any key-shaped string
  that does not resolve. Put key tables in code as literal strings.
- `echarts-wordcloud` declares a stale `echarts@^5` peer. It runs fine on
  echarts 6 (all the legacy APIs it uses are still exported), so `package.json`
  carries an `overrides` entry. Do not "fix" it by pinning echarts back to 5.
- **Real paths everywhere, including the packaged apps.** There is no
  HashRouter and no hash shim: `tauri::manager::get_asset()` falls back through
  `<path>.html`, `<path>/index.html`, then `index.html`, so the Tauri webview
  resolves `/games/730` on its own. The old claim that it "has no server-side
  fallback" was out of date. See `docs/plan/15-sveltekit-migration.md`.
  HashRouter-era `/#/…` URLs from released 1.4.x builds are still upgraded on
  load by `upgradeLegacyHashUrl()` — do not remove it.
- **The CSP lives in `web/svelte.config.js` (`kit.csp`), not in `_headers`.**
  SvelteKit emits one inline bootstrap script per page and hashes it there. A
  header CSP cannot coexist: browsers enforce the INTERSECTION of header and
  meta policies, so a `script-src 'self'` header blocks the script whatever the
  meta says, and the whole app renders its HTML and then fails to hydrate.
  `frame-ancestors` is ignored in a meta CSP, so `X-Frame-Options: DENY` in
  `web/static/_headers` is what stops framing.
- **That CSP has TWO flavours, chosen by `TAURI_ENV_PLATFORM`.** Under Tauri
  the page origin is `tauri://localhost`, so `'self'` means the BUNDLE, not the
  site — a `connect-src 'self'` policy blocks every `/api/data/*` fetch and the
  packaged apps show an empty catalogue. `svelte.config.js` adds
  `https://free-steam-games.win`, `https://api.github.com`, `ipc:` and
  `http://ipc.localhost` only for that build; the web policy stays `'self'`,
  because dropping `api.github.com` from it was deliberate (`/api/activity`
  proxies it). Tauri sends its OWN policy as a header from
  `tauri.conf.json`, which is why that one carries `script-src 'unsafe-inline'`:
  the two intersect, and the meta policy's sha256 is what actually enforces.
- **`adapter-static`'s `fallback` must not be named `index.html`.** It is
  written last and overwrites whatever shares its name, which silently replaced
  the prerendered home page with an empty shell. It is `200.html`.
- **`kit.paths.relative` must stay `false`.** SvelteKit defaults it to `true`,
  which gives every PRERENDERED page `./_app/...` asset URLs. Served as the
  fallback for `/games/730` those resolve to `/games/_app/...`, which misses,
  falls into the SPA handler, and comes back as `index.html` with
  `Content-Type: text/html` at HTTP 200 — so the browser refuses the module
  and the page never hydrates. Invisible until a route actually falls through,
  because `200.html` was always absolute.
- **An unmatched path is answered with `index.html`, which is the prerendered
  DASHBOARD — and a prerendered page hydrates as its own route.** Cloudflare's
  `not_found_handling: "single-page-application"` names no file, and Tauri's
  `get_asset()` chain is compiled in, so neither can be pointed at `200.html`.
  `_redirects` cannot either: Workers Static Assets has no 200-status rewrite
  and honours `/games/* /200.html 200` as a REDIRECT (measured: the address bar
  became `/200`). The symptom is subtle — `page.route.id` and `page.url` are
  CORRECT, so the canonical tag and og:url look right; only the rendered
  components are the dashboard's. `web/src/lib/fallback-route.ts` re-navigates
  on first mount for the routes in `MAY_FALL_BACK` — unless the route's own page
  hydrated, which each of those pages announces by calling
  `markRouteRendered()` from its top-level script. That check is what lets a
  PRERENDERED `/games/730` skip the re-render while a game added after the last
  deploy, every Tauri game page and every studio page still recover.
  `fallback-route.test.ts` holds the list against the routes whose `prerender`
  is not literally `true`, and checks each one marks itself. A path that matches NO route hydrates the same
  way with `page.route.id === null`; the root layout renders the 404 view in
  place. Never `goto()` an unmatched URL — SvelteKit falls back to a native
  load, the host answers with `index.html` again, and it loops forever.
- **Game pages are prerendered from build-time seeds, through a UNIVERSAL load.**
  `build/game-seeds.ts` serves `virtual:game-seeds`: in the SSR build it reads
  `../data` and inlines a seed per game (slow-changing fields only — never
  players or reviews); in the client build `seedFor()` reads the page's own
  `#game-seed` JSON block, so the load returns the same value while hydrating.
  Do not turn it into `+page.server.ts`: client navigation would then fetch
  `__data.json`, which for a game added after the deploy is `index.html` at
  200, and the page errors. `__PRERENDER_GAMES__` is false for Tauri.
  `kit.prerender.handleHttpError` ignores 404s under `/img/` and `/api/` only,
  because the crawler follows the page's `<img>` into a Worker route that does
  not exist at build time.
- **Nothing may gate the markup behind `onMount`.** onMount does not run during
  prerender, so anything behind it ships an empty body and the SEO reason for
  prerendering is gone. The consent gate is an OVERLAY for this reason, not a
  replacement for the page.
- **`/api/data/*` sends `Access-Control-Allow-Origin: *` on purpose.** The
  Tauri apps fetch it cross-origin (`tauri://localhost`,
  `http://tauri.localhost`); without it they cannot load the catalogue at all.
  Never add CORS to `/api/admin/*` or `/api/ingest/*`, and never set
  `Cross-Origin-Resource-Policy` on Worker responses — the same apps load
  `/img/*` cross-site.
- **Every page's `<head>` comes from `web/src/lib/common/Seo.svelte`.** Do not
  hand-write `<title>` in a route — two title elements resolve by DOM order,
  silently. `og:image`/`og:url` must stay absolute from `SITE_ORIGIN`, never
  `page.url.origin`, which during prerender is SvelteKit's internal
  `http://sveltekit-prerender` host. `seo.test.ts` enforces both.
- **`sitemap.xml` is a prerendered route**, not a static file, driven by
  `import.meta.glob` over the route table. It needs `kit.prerender.entries`
  because nothing links to it. Extra exports from a `+server.ts` must be
  `_`-prefixed or SvelteKit rejects the build.
- **`static/` art is generated.** `icon.svg` is the only hand-edited mark;
  `scripts/gen-icons.py` derives the PNG icons and `og.png` from it. Social
  platforms do not render SVG previews, and `apple-touch-icon` never accepted
  SVG.
- **The web app registers its service worker itself, after consent.**
  `@vite-pwa/sveltekit` cannot inject a registration script — SvelteKit has no
  `index.html` for it to write into — so for the whole of 2.0.0 the worker was
  built and never registered, and the manifest was linked from no page.
  `lib/pwa-state.svelte.ts` calls `registerSW` (`registerType: "prompt"`, so a
  new version waits for the reader's Reload instead of reloading under them),
  and the root layout emits `pwaInfo.webManifest.linkTag`. The Tauri build gets
  no-op stubs for both virtual modules. `verify-dist.mjs` checks the manifest
  link on web and its absence in the Tauri build.
- **The packaged apps must never register a service worker.** One registered
  at `tauri.localhost` can NEVER be updated — the update algorithm refetches
  the worker script bypassing the worker, and Tauri's custom protocol does not
  satisfy it ("An unknown error occurred when fetching the script"). The worker
  from whatever version ran FIRST then serves its own precache, including
  `index.html`, forever: the 2.0.0 build launched showing the 1.4.x React UI
  inside the new window. No frontend fix is possible, because the frontend that
  would do the fixing is the part being served stale. `vite.config.ts` omits the
  PWA plugin when `TAURI_ENV_PLATFORM` is set, and
  `src-tauri/src/lib.rs::purge_stale_webview_data` clears the webview's storage
  for an install whose previous version stamp is missing or older than 2.0.0 —
  ONLY those. It used to clear on every version change, which with a working
  updater would have wiped consent, theme, language and the cached catalogue
  on every release. `needs_purge` has unit tests (`cargo test --lib`).
- **The desktop updater's feed is `/api/updates/desktop`, not GitHub's "latest"
  release.** This repository publishes dataset (`v*`), Android and desktop
  releases on one page, so `releases/latest/download/latest.json` was usually
  not a desktop release and 404ed. `worker/routes/updates.ts` reads
  `releases.atom` (drafts never appear, no API rate limit), picks the highest
  `desktop-vX.Y.Z`, validates its `latest.json` (version matches the tag, every
  artefact URL is this repo's release download) and answers 204 — the updater's
  "no update" — for anything unusable. Like `/api/activity` it is public and
  must never use the GitHub App token. A desktop release is offered only once
  its draft is published.
- The app is behind a first-run legal consent gate
  (`web/src/lib/common/ConsentGate.svelte`). Only `/error/*` and `/legal/*`
  bypass it — the gate links to the legal documents it asks people to accept —
  and any new route that must be reachable pre-consent has to join that list.
  The gate renders only after `consent.hydrated`: rendered before storage was
  read, it was baked into every prerendered page and flashed for returning
  visitors.
- **`/welcome` is shown once, by the layout, and only to a visit that STARTED
  on `/`** (not a deep link, not `/#/…`, not mid-session), after consent. It
  uses `replaceState`, and the page marks itself seen on mount, so Back cannot
  loop into it. Crawlers never consent, so `/` stays the indexable page.
- **`/legal/[doc=legaldoc]` has a param matcher** (`src/params/legaldoc.ts`).
  An unknown slug therefore matches NO route and gets the layout's translated
  404; without it the host's fallback (the prerendered dashboard) hydrated as
  the doc route. Legal labels and hints in `lib/legal.ts` are i18n keys.
- **`/games` mirrors its filters into the query string, browser-only**:
  `onMount` reads `location.search` (a link with filter parameters replaces the
  stored filters) and a debounced `replaceState` writes back. Never read
  `url.search` in markup or a load - prerender throws on it. The page number
  lives in the filter store, keyed to the criteria (`filters.pageFor`), so Back
  from a game keeps the page and a changed filter starts again at page 1.
- **`safe` is classified by `lib/safety.ts`** (`y`, `n`, `?` = not reviewed,
  `""` = never set). `/games`, `/stats` and `/health` all use it; `?` is a
  to-do, not missing data, so /health reports it as its own group.

## Admin SPA (`web/admin/`)

- **It is part of the Worker script, never of `dist/`.** `admin/vite.config.ts`
  builds it and `admin/build/emit-worker-bundle.ts` writes the gitignored
  `worker/generated/admin-bundle.ts`, which `worker/routes/admin-spa.ts` serves
  only after `worker/index.ts` has done the Access, credential-class and CSRF
  checks. `dist/` is readable by anyone, precached by the service worker and
  packaged into the apps, so admin code there would be public whatever Access
  says. `scripts/verify-dist.mjs` fails on `dist/admin` or any `/api/admin/`
  string in `dist/`.
- **`npm run build` must keep running `build:admin`,** and `typecheck` builds it
  first: `worker/index.ts` imports the generated module, so a bare
  `wrangler deploy` or `tsc` without it fails. That failure is intended.
- **One script, no code splitting.** The shell's CSP is `script-src` with a
  per-response nonce and nothing else, so a lazily imported chunk would be
  blocked. The emitter fails the build on a second script, an inline script or
  a second JS file. Do not add `'unsafe-inline'` or `'strict-dynamic'` to make a
  chunk load.
- **Routes are `shared/admin-routes.ts`.** `serveAdmin` 404s every other path
  under `/admin` (the old Worker served the queue for any typo). A new page goes
  there AND in `App.svelte`'s `NAV`; `admin/security.test.ts` holds them equal.
- **It may import only pure modules of the public app**: `src/lib/ui/*`,
  `src/lib/utils.ts`, `src/lib/prefs.svelte.ts`, `src/fonts.css`,
  `src/styles/theme.css` (the design tokens, shared by both builds). Never
  `$app/*` or `$lib/*`; that build cannot resolve them.
- **`admin/mock/` is a dev server, not a mode.** `npm run dev:admin` runs the
  real handlers against an in-memory D1 and fake GitHub; nothing under `worker/`
  or `admin/src` may import it, and the Worker has no flag that skips
  authentication. Keep it that way.
- **No raw HTML.** Game names, reasons, payloads and audit detail are text
  other people wrote; `{@html}` and `innerHTML` are banned by
  `admin/security.test.ts`.
- **`admin/src/lib/api.ts` fetches with `redirect: "manual"`.** An opaque
  redirect, 401 or 403 is a lapsed Access session and reloads the page ONCE
  (guarded in sessionStorage, so a persistent refusal cannot loop). A non-JSON
  body is a server error, never "session expired": that misreport hid real
  Worker crashes in the old admin pages.
