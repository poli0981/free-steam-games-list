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
  appid can have several rows). `/admin/api/decide` refuses such rows in its
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
- **Nothing `/admin` writes to Git may name a person.** Commit bodies and
  `data/overrides/*.json` say `ADMIN_ATTRIBUTION` ("admin",
  `web/shared/admin-api.ts`); a public repository keeps them forever.
  `appendLinks()` takes no actor parameter at all, so the old
  `Approved in /admin by <email>` cannot come back by a call site forgetting.
  D1 still stores the real Access identity in `audit_log.actor`,
  `ingest_queue.decided_by`, `ingest_decisions.decided_by` and
  `commit_jobs.requested_by`, which is what `/admin/audit` filters on —
  do not "tidy" those to the constant too.
- **`BLOCKED_COUNTRIES` is defence in depth, not the block.** The Worker
  refuses those countries (`worker/lib/geo.ts`), but it only ever sees the four
  `assets.run_worker_first` prefixes — every prerendered page is served without
  invoking it. A WAF custom rule on the zone is the boundary
  (`blocked-countries`, live since 2026-09-20; `docs/SECURITY_SETUP.md` §4,
  which also carries the `human-check-pages` Managed Challenge and every path
  it must keep excluding). `geo.ts` FAILS OPEN on an unknown country:
  `request.cf` is undefined under Vitest and under `wrangler dev` without
  `--remote`, and failing closed there 403s every test.
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
  HashRouter-era `/#/…` URLs still arrive - from released 1.4.x builds, and from
  old links to the GitHub Pages site, whose tombstone redirect forwards the
  fragment - and `upgradeLegacyHashUrl()` upgrades them on load with
  `goto(…, {replaceState})`. Do not remove it, and do not reduce it to a
  `history.replaceState`: that fixed the address bar and left the dashboard
  rendered.
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
  The web policy has three hosts the Tauri one must never gain:
  `https://static.cloudflareinsights.com` in `script-src` and
  `https://cloudflareinsights.com` in `connect-src`, for the analytics beacon,
  and `https://challenges.cloudflare.com` in `script-src` AND `frame-src`, for
  the Turnstile human check (the widget is an iframe; without `frame-src` it
  falls back to `default-src 'self'` and is refused). The Tauri policy has no
  `frame-src` at all. `verify-dist.mjs` fails the web build without them and
  the Tauri build with any of them.
- **Cloudflare Web Analytics must stay on "JS Snippet installation", never
  automatic.** Automatic injection adds an INLINE loader at the edge, after our
  response; `kit.csp` is `mode: "hash"`, and CSP3 makes a `script-src` carrying
  a hash ignore `'unsafe-inline'` — so no policy can ever admit it. It was
  enabled that way for months, logging two CSP violations per page load and
  collecting nothing. `lib/analytics.ts` appends the beacon itself, from the
  `$effect` in the root layout that waits for consent and the human check,
  never under Tauri, and does nothing when `CF_BEACON_TOKEN` is empty.
- **The Turnstile human check is web only, runs AFTER consent, and is soft by
  design.** `lib/common/HumanCheck.svelte` is an overlay like the consent gate
  (opens only after `humanCheck.hydrated`, so it is never prerendered;
  `verify-dist.mjs` fails a page containing its title), once per 24 h per
  browser (`f2p:human_check`). The catalogue fetch, service-worker
  registration, analytics and the `/welcome` redirect wait for `appReady()`
  (`lib/app-ready.ts`: consent accepted AND the check cleared), and every
  `Resource` passes it as `enabled`, so a page that calls `load()` itself (or
  refetches on focus) cannot jump the gates — `resource.test.ts` fails on a
  `new Resource` without it. The token is verified by
  `POST /api/human-check` (`worker/routes/human-check.ts`, secret
  `TURNSTILE_SECRET`, action and hostname checked; constants in
  `shared/human-check.ts`). Nothing on the server requires a pass, and nothing
  may: the pages never reach the Worker, and `docs/ToS.md` §9 promises
  `/api/data/*`, `/img/*` and the apps are never human-checked — making them
  require one breaks that promise and the packaged apps. It refuses only on a
  verdict (the route's 403, a 300xxx/600xxx widget error); a missing secret or
  a test widget's token meeting the real secret (503), siteverify trouble
  (502), a widget configuration error and being offline all let the reader
  through for that page load, unrecorded. Off under
  Tauri, under `npm run dev` (its `/api` proxy is production), and when
  `TURNSTILE_SITEKEY` is empty. The pure rules are in `lib/human-check.ts`,
  tested without Svelte. Never write the overlay's title into a legal document:
  the privacy policy is prerendered and would trip that verify-dist check.
- **Every `<img>` carries a literal `referrerpolicy="no-referrer"`.** The zone
  has Cloudflare Hotlink Protection on; it 403s `/img/*` for any Referer that
  is not this site, at the edge before the Worker, and allows a request with
  none. The Tauri webviews send `http://tauri.localhost/` (Windows, Android),
  which blanked every image in the 2.0.0 apps; 2.0.0 installs survive on a
  Configuration Rule (`docs/SECURITY_SETUP.md` §10). `src/lib/images.test.ts`
  fails on an `<img>` without the attribute. Do not "fix" it with a
  `<meta name="referrer">` or by relying on the webview's default.
- **`adapter-static`'s `fallback` must not be named `index.html`.** It is
  written last and overwrites whatever shares its name, which silently replaced
  the prerendered home page with an empty shell. It is `200.html`.
- **…and the service worker's `navigateFallback` must NOT be `/200.html`.**
  `generateFallback()` writes that file straight into `dist/`, after workbox
  has globbed `.svelte-kit/output`, so it can never be in the precache —
  `createHandlerBoundToURL()` threw `non-precached-url` on every load and
  abandoned the rest of the worker's setup. It is `/`, which is both precached
  and exactly what Cloudflare and Tauri already serve for an unmatched path, so
  `lib/fallback-route.ts` recovers the route offline the same way it does
  online. `verify-dist.mjs` now parses `dist/sw.js` and fails if the bound URL
  is not a precache entry.
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
- **`/api/data/*` and `/api/activity` send `Access-Control-Allow-Origin: *` on
  purpose.** The Tauri apps fetch them cross-origin (`tauri://localhost`,
  `http://tauri.localhost`); without it they cannot load the catalogue or the
  activity feed at all.
  Never add CORS to `/admin/api/*`, `/api/ingest/*` or `/api/human-check`
  (same-origin by design; the apps never run the check), and never set
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
- **The web app registers its service worker itself, after consent and the
  human check.**
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
- **Legal consent is per-document content hashes, not one integer.**
  `build/legal-versions.ts` serves `virtual:legal-versions` (a hash per
  document, inlined) and `virtual:legal-sources` (the raw markdown, imported
  DYNAMICALLY by `ConsentGate.svelte` alone, so a normal page load never
  fetches those 25 KB). Editing `docs/EULA.md` now reopens the gate by itself,
  showing only that document as a `lib/diff.ts` diff against the copy in
  `f2p:legal_snapshot`. `TERMS_VERSION` survives only as the "make everyone
  read all six again" override — bumping it for a routine edit defeats the
  feature. The state lives in `lib/consent.svelte.ts`, NOT `prefs.svelte.ts`:
  the admin SPA imports the latter and its build cannot resolve a virtual
  module. Render the diff as text in a `<pre>`, never `{@html}`.
- The app is behind a first-run legal consent gate
  (`web/src/lib/common/ConsentGate.svelte`). Only `/error/*` and `/legal/*`
  bypass it — the gate links to the legal documents it asks people to accept —
  and any new route that must be reachable pre-consent has to join that list,
  which is `isUngatedPath()` in `lib/gates.ts`, shared with the human check.
  The gate renders only after `consent.hydrated`: rendered before storage was
  read, it was baked into every prerendered page and flashed for returning
  visitors.
- **`/welcome` is shown once, by the layout, and only to a visit that STARTED
  on `/`** (not a deep link, not `/#/…`, not mid-session), after consent and
  the human check. It
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
  says. `scripts/verify-dist.mjs` fails on `dist/admin` or any `/admin/api/`
  string in `dist/`.
- **Its API lives at `/admin/api/*`, under the page, never beside it.**
  Cloudflare Access issues its cookie per application, and `fetch()` cannot
  follow its sign-in redirect, so an API behind an application of its own
  (it was `/api/admin/*`) answered every call with a login redirect: the SPA
  said "session expired" straight after signing in, incognito included.
  `ADMIN_API_PREFIX` in `shared/admin-routes.ts` is the one definition, and
  `worker/index.test.ts` drives it through the real router and Access check,
  which the handler tests never did.
- **`npm run build` must keep running `build:admin`,** and `typecheck` builds it
  first: `worker/index.ts` imports the generated module, so a bare
  `wrangler deploy` or `tsc` without it fails. That failure is intended.
  `build:admin` runs `svelte-kit sync` first: the admin imports files under
  `web/src`, whose `tsconfig.json` extends `.svelte-kit/tsconfig.json`, and on a
  clean checkout (CI) that file does not exist until SvelteKit has synced. The
  emitter reads the bundle in `writeBundle`, never the output directory in
  `closeBundle`, which also runs after a FAILED build and hid that error behind
  an ENOENT.
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
