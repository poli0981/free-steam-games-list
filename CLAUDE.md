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

- **`data/index.json.last_updated` is the only cache-invalidation signal.**
  `web/src/lib/cache.ts` keys its IndexedDB cache on it. Commit a shard without
  bumping it and every browser keeps serving pre-edit records. Anything that
  writes a shard must also bump it.

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
  on first mount for the three routes that are never prerendered, and
  `fallback-route.test.ts` holds its list against the routes that actually
  declare `prerender = false`.
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
  once per version for anyone upgrading from a build that had one.
- The app is behind a first-run legal consent gate
  (`web/src/lib/common/ConsentGate.svelte`). Only `/error/*` bypasses it —
  any new route that must be reachable pre-consent has to join that list.
