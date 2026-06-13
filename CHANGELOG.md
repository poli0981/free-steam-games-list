# Changelog

All notable changes to this awesome noob repo will be documented here.

## [v3.4.0] – 2026-06-13 (The "Legal Consent Gate" Edition)

Feature release on top of v3.3.0 adding an explicit, up-front acceptance of the project's legal documents on both surfaces: a first-run consent gate in the app (web + desktop) and a real license-agreement page in the Windows installer. No backend, no cookies — acceptance is a single `localStorage` flag, versioned so it can re-prompt when the terms change, and naturally fresh in incognito/private tabs. Web app + desktop bumped `1.3.0` → `1.4.0`. Repo public-facing version `3.3.0` → `3.4.0`. Tag `v3.4.0` is GPG-signed; companion desktop tag is `desktop-v1.4.0`.

### ⚖️ First-run consent gate (web + desktop)

- New [ConsentGate.tsx](web/src/components/common/ConsentGate.tsx) — a full-screen card (styled like the error pages, eager bundle, no flash) that blocks the main UI until the user ticks a checkbox and clicks **Continue**. Mounted inside `AppErrorBoundary` + `HashRouter` in [main.tsx](web/src/main.tsx), wrapping `<App/>` (the `<Toaster/>` stays a sibling). A gate crash is still caught by the top-level boundary.
- **Decline path** — explicit **Decline** button: on desktop (Tauri) it quits the app via `getCurrentWindow().close()`; on web it shows a blocking "you need to accept" notice with a way back to the gate.
- **Persistence** — new [stores/consent.ts](web/src/stores/consent.ts) (Zustand, same pattern as `stores/gpg.ts`): `localStorage` key `f2p:legal_consent` holding `{ version, acceptedAt }`. A `TERMS_VERSION` constant gates validity — bump it when the legal docs change materially and everyone is re-prompted. Incognito tabs get a fresh storage partition, so the gate re-shows there with zero extra code. No cookie is used anywhere (there is no server to read one).
- **Error routes pass through** — the gate lets `#/error/*` render even before consent, so a mid-session chunk-load 503, the Pages `404.html` redirect, or an `#/error/:code` deep link still reaches the user instead of being swallowed.
- **Doc links** — the gate's five binding documents (MIT License, EULA, Privacy Policy, Disclaimer, Terms of Use) open through the existing [external-open.ts](web/src/lib/external-open.ts) `openExternal()` helper, so they work inside the Tauri webview (which blocks `window.open` to external HTTPS) as well as on the web.
- **Shared legal list** — the `LEGAL_DOCS` array (label / path / hint) was lifted out of [About.tsx](web/src/pages/About.tsx) into a reusable [lib/legal.ts](web/src/lib/legal.ts) (`LEGAL_DOCS`, `CONSENT_DOCS`, `legalDocUrl()`); About now imports it instead of holding a private copy.
- New `consent.*` i18n keys added to both [en.json](web/src/i18n/locales/en.json) and [vi.json](web/src/i18n/locales/vi.json). Long-form legal copy stays English (the doc labels come from `LEGAL_DOCS`); only the gate chrome is bilingual.

### 🪟 Windows installer license page

- [tauri.conf.json](web/src-tauri/tauri.conf.json) now sets `bundle.licenseFile` to a new [LICENSE_AGREEMENT.rtf](web/src-tauri/LICENSE_AGREEMENT.rtf). Tauri v2 surfaces this as a mandatory "I Agree" license page in **both** Windows targets built by `targets: "all"` — the NSIS `-setup.exe` (MUI license page) and the WiX `.msi` (which requires RTF). The RTF is plain ASCII with no BOM to avoid the known NSIS license-encoding bug.
- The installer gate (install-time, desktop-only) and the in-app gate (first-run, web + desktop, re-promptable) are intentionally both kept: the auto-updater replaces the binary without re-running the installer, so the in-app `TERMS_VERSION` mechanism is the only way to re-prompt updated installs.
- Desktop window-close on decline needs the `core:window:allow-close` permission, now added to [capabilities/default.json](web/src-tauri/capabilities/default.json). New dependency `@tauri-apps/api` (official, lazy-imported only on the desktop decline path — no web-bundle bloat).

### 🧰 Tooling & misc

- Version bumped across the three desktop files ([web/package.json](web/package.json), [tauri.conf.json](web/src-tauri/tauri.conf.json), [Cargo.toml](web/src-tauri/Cargo.toml)) → `1.4.0`; the stale README version badge corrected `3.2.7` → `3.4.0`.
- Pre-publish suite (`typecheck`, `knip`, `npm audit`, `vulture`, `pip-audit`) re-run clean.

## [v3.3.0] – 2026-06-12 (The "Lazy-Load + Error Pages" Edition)

Feature release on top of v3.2.7, two themes: a web-app performance overhaul (route-level code splitting, lazy echarts/openpgp/locale chunks — first-load JS drops from ~574 KB to ~163 KB gzipped, −72%) and a proper error-page system (403/404/419/5xx/offline pages, React error boundaries, a real GitHub Pages `404.html`). Web app + desktop bumped `1.2.7` → `1.3.0`. Repo public-facing version `3.2.7` → `3.3.0`. Tag `v3.3.0` is GPG-signed; companion desktop tag is `desktop-v1.3.0`.

### ⚡ Lazy-loading overhaul

- **Route splitting** — [web/src/App.tsx](web/src/App.tsx): every page except `Dashboard` (the landing route) is now `React.lazy` via a new `lazyWithRetry` helper ([web/src/lib/lazy.ts](web/src/lib/lazy.ts)). The `<Suspense>` boundary sits inside [Layout.tsx](web/src/components/layout/Layout.tsx) around `<Outlet/>`, so the sidebar/topbar stay mounted during navigation; fallback reuses the existing `LoadingState`.
- **echarts (~666 KB raw)** — new [LazyEChart.tsx](web/src/components/charts/LazyEChart.tsx) wrapper is the single dynamic boundary for `EChart.tsx` (which keeps the `echarts.use([...])` registration). All 15 chart components swap one import line; a fixed-height `animate-pulse` skeleton prevents layout shift. echarts now downloads only when a chart mounts.
- **openpgp (~391 KB raw)** — [web/src/lib/gpg.ts](web/src/lib/gpg.ts) switches to a type-only import + memoized `await import("openpgp")`. All exports were already async, so zero caller changes; visitors without a saved GPG key never download the crypto chunk at all.
- **Per-locale i18n** — [web/src/i18n/index.ts](web/src/i18n/index.ts): `en.json` stays bundled (it's `fallbackLng` — a missing key can never render raw), `vi.json` becomes a dynamic import. `initI18n()` preloads the detected locale before `i18n.init`, and [main.tsx](web/src/main.tsx) awaits it before first render — no flash of raw keys, verified with a hard reload under `f2p:lang=vi`. `setLanguage()` is now async and loads the bundle *before* switching. Also syncs `<html lang>` (was hardcoded `vi` for everyone).
- **manualChunks fix** — forcing `echarts`/`openpgp` into `manualChunks` made Rollup hoist shared helpers (tslib) *into* the echarts chunk, which the eager graph then statically imported — echarts was being modulepreloaded on first paint, nullifying the lazy boundary. Both entries are removed from [vite.config.ts](web/vite.config.ts); the dynamic-import boundaries split them naturally. `dist/index.html` now modulepreloads only `react` + `query`.
- Net effect: eager JS `~1746 KB → ~494 KB` raw (`~574 → ~163 KB` gzip). The PWA still precaches everything in the background, but first paint no longer waits for charts + crypto.

### 🚦 Error pages (403 / 404 / 419 / 500 / 502 / 503 / 504 / offline)

- New [web/src/pages/errors/ErrorPage.tsx](web/src/pages/errors/ErrorPage.tsx) — one config-driven component: per-code lucide icon + tone (neutral/warn/destructive, reusing the exact `ErrorState`/`PwaIndicator` palettes), mono `ERROR {{code}}` badge, i18n'd title/description, and three actions (Go home / Reload / Report issue → GitHub Issues). Full `errors.*` key blocks added to both [en.json](web/src/i18n/locales/en.json) and [vi.json](web/src/i18n/locales/vi.json). Kept in the eager bundle on purpose — error UI must not live in a lazy chunk.
- Routing — `#/error/:code` deep links via `ErrorCodeRoute` (unknown codes render 404 in place, no redirect), and the catch-all `<Route path="*">` now shows a real 404 page instead of silently redirecting to the Dashboard.
- **GitHub Pages `404.html`** — new [web/public/404.html](web/public/404.html): standalone dark page (inline CSS, no JS deps), bilingual via a one-liner that respects the app's own `f2p:lang`, `noindex`, absolute link back to `/free-steam-games-list/#/`. Excluded from the SW precache via `globIgnores` in [vite.config.ts](web/vite.config.ts) — SW-controlled clients get `navigateFallback` and never see it.

### 🛡️ Error boundaries + stale-deploy resilience

- New [ErrorBoundary.tsx](web/src/components/common/ErrorBoundary.tsx) (own ~40-line class, no new dep) with a `resetKey` prop — navigating away clears a stuck error *without* remounting the page subtree on every navigation (which `key` would do, destroying table scroll/selection state).
- Two mounts: route-level inside `Layout` (chunk-load error → 503 page with "new version deployed, reload" copy; render crash → 500 page, error message shown in dev only), and a top-level [AppErrorBoundary](web/src/components/common/AppErrorBoundary.tsx) outside the router with inline styles + hardcoded bilingual strings — immune to i18n/Tailwind/router failures.
- `lazyWithRetry` handles the deploy-mid-session case: a chunk 404 triggers ONE auto-reload per tab (`sessionStorage` flag, try/catch-guarded for lockdown webviews) which also picks up the waiting service worker; a second failure throws to the boundary.

### 🔌 Real error flows wired in

- [QueryState.tsx](web/src/components/common/QueryState.tsx) `ErrorState` upgraded in place (contract preserved): offline detection swaps in the `errors.offline.*` copy + `WifiOff` icon, plus Retry / Report-issue action buttons. All 17 call sites now pass `onRetry={() => void q.refetch()}`.
- Expired/revoked token on session restore ([stores/auth.ts](web/src/stores/auth.ts) `hydrate()` catch) now fires a Sonner toast with the shared `errors.419.*` copy and an "Open Settings" action (10 s duration — the 4 s default is too short for action toasts). Deliberately a toast, not a redirect: don't hijack whatever page the user opened. Auth gating on `/add` stays as-is.

### 🖼️ Images

- `decoding="async"` added to every `<img>` (10 sites: table thumbs, mobile cards, command palette, detail drawer, avatars, About QRs) — keeps image decode off the main thread during virtualised scrolling.
- Detail drawer header image now goes through a new `preferWebp()` ([web/src/lib/image.ts](web/src/lib/image.ts)): weserv WebP transcode (~50 KB → ~20 KB) on web, **direct Steam URL on Tauri desktop** (no third-party calls from the bundled app), with an `onError` fallback to the original. Replaces the old `<picture><source>` markup, which only falls back on unsupported *type* — a weserv outage would have shown a broken image. Thumbnails intentionally stay on direct Steam capsules (~10 KB, SW-cached); `webpProxyUrl` is no longer exported.

### ⌨️ Search responsiveness

- [GamesTable.tsx](web/src/components/games/GamesTable.tsx): the Fuse.js search input is wrapped in `useDeferredValue` — typing stays per-keystroke responsive while filtering ~1.2k records lags at React's low priority. No debounce timer (deferral only delays when the machine is actually busy). Same treatment + `useMemo` for the command palette's game scan.

### 🧰 Tooling & misc

- `rollup-plugin-visualizer` devDependency + `npm run analyze` (`vite build --mode analyze` → `dist/stats.html` treemap, gzip/brotli sizes).
- [index.html](web/index.html): `preconnect` hints for `raw.githubusercontent.com` (shard fetches, crossorigin) and `shared.akamai.steamstatic.com` (thumbnails).
- `npm audit fix` — react-router open-redirect advisory GHSA-2j2x-hqr9-3h42 (`react-router-dom` 6.30.x patch line); `npm audit` and `pip-audit` both report 0 known vulnerabilities.

## [v3.2.7] – 2026-05-22 (The "Coming-Soon Guard + Dead-Code Cleanup" Edition)

Maintenance release on top of v3.2.6. A small, useful batch: the Python pipeline now rejects unreleased ("coming soon") games at ingest instead of listing titles nobody can play yet; a one-time dead-code sweep across the web app and the pipeline; and three dev-tooling additions (knip, vulture, pip-audit) so future releases can run the same checks. Web app + desktop bumped `1.2.6` → `1.2.7`. Repo public-facing version `3.2.6` → `3.2.7`. Tag `v3.2.7` is GPG-signed; companion desktop tag is `desktop-v1.2.7`.

### 🚧 Coming-soon games rejected at ingest

- `scripts/core/health_checker.py` — new `COMING_SOON` status, added to the `REMOVABLE` set. `check_game_health()` now reads the Steam `appdetails` flag `release_date.coming_soon` right after the API response resolves (before the `is_free` check) and returns `HealthResult(COMING_SOON, …)` for unreleased titles.
- Effect: `ingest_new.py` rejects coming-soon entries from the queue and logs them to `removed_games.jsonl` with reason "Not yet released (coming soon)" — the same path `NOT_FREE` already uses. `purge_unhealthy.py`'s weekly scan likewise evicts any coming-soon title already in the dataset.
- Rationale: an F2P *games* tracker should list playable titles. A coming-soon game has zero players, no reviews, and an unconfirmed price (it can launch paid). The API flag is used instead of scraping the `game_area_comingsoon` HTML block — it's already fetched during the health check and is authoritative. No schema change.

### 🧹 Web dead-code cleanup (knip)

- New `knip` sweep (config in `web/knip.json`). Removed two unused files: `src/components/common/UpdateChecker.tsx` — the Tauri auto-update component, never wired into `Layout.tsx` since Phase 9, so the frontend update check never actually ran — and `src/components/ui/switch.tsx`, an unused shadcn primitive.
- Removed 11 unused dependencies from `web/package.json`: 7 Radix primitives (`react-dropdown-menu`, `react-scroll-area`, `react-select`, `react-switch`, `react-tabs`, `react-toast`, `react-tooltip`), `@tanstack/react-table` (the virtualised table uses only `@tanstack/react-virtual`), and 3 Tauri packages (`@tauri-apps/api`, `@tauri-apps/plugin-process`, `@tauri-apps/plugin-updater` — the last two were referenced only by the removed `UpdateChecker`).
- `vite.config.ts` — dropped the now-stale `@tanstack/react-table` entry from the `manualChunks.table` group.
- knip's remaining "unused export" findings inside the `src/lib/*` port modules are intentional API surface; they're set to `warn` so `npm run knip` stays green.

### 🧹 Python dead-code cleanup (vulture)

- Deleted `scripts/dedup_removed_games.py` — the one-shot v3.2.4 migration, completed and now redundant (`dedup_removed()` runs inside the pipeline on every write). Same rationale as v3.2.4's removal of `migrate_to_shards.py`.
- `scripts/core/data_store.py` — dropped the unused `EXTENSION_FIELDS` import. The constant stays defined in `constants.py` as the documented MANUAL/ARRAY/EXTENSION field-class trio (mirrored in `web/src/lib/schema.ts`).
- `scripts/core/steam_client.py` — `__exit__(self, *a)` → `__exit__(self, *_)` (idiomatic unused-varargs name).

### 🧰 Dead-code & audit tooling

- **knip** — `web/package.json` devDependency + `npm run knip` script + `web/knip.json`. Finds unused files / exports / dependencies in the TypeScript SPA.
- **vulture** + **pip-audit** — new `requirements-dev.txt`; vulture config in a new root `pyproject.toml` (`[tool.vulture]`, `min_confidence = 80`). Python dead-code detection + dependency CVE audit.
- All three run at dev time only — nothing new ships in the pipeline, web bundle, or desktop app.

### 📄 Docs

- New `docs/THIRD_PARTY.md` — documents the dev tooling above (purpose, license, where declared) and the canonical pre-publish check suite. Linked from the README "Docs" section.
- Synced the third-party dependency lists to the removals above — `docs/ACKNOWLEDGEMENTs.md`, the in-app `/about` page (`web/src/pages/About.tsx`), and `web/README.md` no longer list the dropped Radix primitives, `@tanstack/react-table`, or `@tauri-apps/api`.

## [v3.2.6] – 2026-05-20 (The "Mobile Hotfix" Edition)

Hotfix on top of v3.2.5. Two mobile-viewport regressions introduced by the v3.2.5 responsive overhaul. Web app + desktop bumped `1.2.5` → `1.2.6`. Repo public-facing version `3.2.5` → `3.2.6`. Tag `v3.2.6` is GPG-signed; companion desktop tag is `desktop-v1.2.6`.

### 🐛 AC Index table — horizontal scroll on mobile

- `web/src/pages/AntiCheatList.tsx` — the per-family table wrapper was `<div className="overflow-hidden rounded-md border">`. On a 390 px viewport the 5-column table (`# / Game / Genre / Kernel / Players`) is wider than the card, and `overflow-hidden` clipped the right-hand columns with no way to scroll to them.
- Fix: `overflow-hidden` → `overflow-x-auto`. The table now scrolls horizontally when it exceeds the viewport, and the scrollbar stays hidden when it fits.

### 🖼️ Mobile game cards — thumbnail fallback

- `web/src/components/games/table/MobileGameCards.tsx` — the card `<img>` loads `headerToCapsule(g.header_image)` (the smaller `capsule_184x69.jpg` variant, ~10 KB vs ~50 KB). Steam's CDN doesn't host that variant for every game, so those cards rendered a blank thumbnail.
- The desktop table column (`table/columns.tsx`) already had an `onError` handler that falls back to the original `header.jpg`; the v3.2.5 mobile card component didn't port it. `GameDetailDrawer` uses `g.header_image` directly, which is why the image always appeared once a card was tapped.
- Fix: add the same `onError` fallback to the mobile card `<img>` — on a 404 it swaps `src` to `g.header_image`, with an `el.src !== g.header_image` guard against an infinite error loop.

## [v3.2.5] – 2026-05-20 (The "AC Nav + Mobile + Games Cleanup" Edition)

Patch release on top of v3.2.4. One reported bug fix + three quality-of-life polish items. **Bug:** clicking any "Family" link in the Anti-Cheat Index sidebar redirected to the Dashboard instead of scrolling to the matching family table — `HashRouter` was treating the `<a href="#vac">` anchor as a route navigation. **Polish:** the `GamesTable` (1318 px wide) now degrades to a virtualised card list below the `md` breakpoint so mobile no longer needs horizontal scroll; the `AntiCheatList` sidebar drops to `md` instead of `lg` and exposes a horizontal chip nav on phones; `KpiCards` adds `md`/`lg` rungs to avoid uneven grid jumps. **Cleanup:** 93 per-genre markdown files in `games/` are removed (the web app's `/games?genre=X` filter has replaced them since v3.0); `generate_tables.py` now skips regeneration when game data hasn't actually changed via a `.gen-hash` checksum, cutting daily catalogue commits to roughly the days that move records. **New:** floating back-to-top button on the main scroll container, fades in past 400 px. Web app + desktop bumped `1.2.4` → `1.2.5`. Repo public-facing version `3.2.4` → `3.2.5`. Tag `v3.2.5` is GPG-signed; companion desktop tag is `desktop-v1.2.5`.

### 🔗 AC Index sidebar navigation fix

- [web/src/pages/AntiCheatList.tsx](web/src/pages/AntiCheatList.tsx): swap `<a href="#anchor">` for `<button onClick>` that calls `document.getElementById(id).scrollIntoView({ behavior: "smooth", block: "start" })`. The `id={anchor}` attribute on each family `<Card>` stays the same — only the click target changes.
- Root cause: `main.tsx:24` uses `HashRouter`. Anchor links inside a hash-routed page produce URLs like `#/charts/anti-cheat/list#vac`. HashRouter parses the trailing `#vac` as a fresh route, the regex doesn't match, and the `<Route path="*" element={<Navigate to="/" replace />}>` fallback in `App.tsx` sends the user to the Dashboard.
- Same fix applied to the new mobile chip nav (below) so behaviour is uniform across viewports.

### 📱 Mobile responsive

- New `web/src/components/games/table/MobileGameCards.tsx` — virtualised card list rendering one card per game with thumb, name, genre/type/AC/status badges, review %, current players, and a Steam-link icon. Shares filter/sort/page state with the desktop table via the existing `useFilters` store.
- [`GamesTable.tsx`](web/src/components/games/GamesTable.tsx) wraps the desktop scroll container in `hidden md:block` and renders `<MobileGameCards>` inside `md:hidden`. No new state, no behaviour drift between views.
- [`AntiCheatList.tsx`](web/src/pages/AntiCheatList.tsx) sidebar changes from `hidden w-48 shrink-0 lg:block` to `hidden md:block md:w-40 lg:w-48` — visible on tablets too. Below `md`, a horizontal scrollable chip rail above the content provides the same family-jump nav.
- [`KpiCards.tsx`](web/src/components/charts/KpiCards.tsx) grid `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7` → `sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7`. Inserts `md` (tablet, 3 cols) and `lg` (small laptop, 4 cols) rungs so the 7 KPIs don't double-stack awkwardly.

### 🧹 `games/` cleanup + smart regen

- **Deleted 93 per-genre `<genre>.md` files** (`action.md`, `fps.md`, `visual-novel.md`, …). Web app `/games?genre=X` is the canonical genre filter since v3.0; no inbound link audit hit anything beyond `games/README.md` (regenerated) and the now-stale "By Genre" section in the index. Files kept: 11 × `all-games_part*.md`, `top-online.md`, `top-offline.md`, `anti-cheat-list.md`, `README.md`.
- [`scripts/generate_tables.py`](scripts/generate_tables.py) drops the genre loop entirely and rewrites the `games/README.md` template to point at part files + leaderboards + AC list, with a one-line note about the web-app genre filter.
- **Smart regen via `.gen-hash`** — script computes `sha256` of sorted `(link, name, genre, reviews, current_players, anti_cheat, is_kernel_ac, status)` tuples and writes the digest to `games/.gen-hash`. Subsequent runs short-circuit (`Skip: no semantic changes (hash=...)`) when the hash is unchanged. Order-invariant, ignores timestamps embedded in MD output, so daily workflow ticks only commit when game data actually moves.

### ⬆️ Back-to-top button

- New `web/src/components/common/BackToTop.tsx` — a fixed-position icon button bottom-right of the viewport. Listens for `scroll` events on the passed scroll container ref (passive listener), fades in (`opacity-100`) past 400 px, becomes pointer-events-none below to avoid blocking click-through.
- [`Layout.tsx`](web/src/components/layout/Layout.tsx) creates a `useRef<HTMLElement>` on `<main>`, passes it as `scrollRef`. Single mount, no per-page wiring.
- i18n: `common.backToTop` added to `en.json` ("Back to top") and `vi.json` ("Lên đầu trang") for `aria-label` + `title`.

## [v3.2.4] – 2026-05-20 (The "Refactor + Removed-Games + Anti-Cheat Index" Edition)

Patch release on top of v3.2.3, landed as two PRs. **PR #74 (cleanup):** two dead scripts removed, `EditGameDrawer.tsx` (718 LOC) and `GamesTable.tsx` (568 LOC) split into focused sub-modules, two new charts (`TopOfflineBar`, `AddedPerMonthBar`) wired to a fresh `/top-offline` page and the existing `/charts/time` page. **PR #75 (features):** the `scripts/removed_games.jsonl` log now passes through a `dedup_removed()` filter on every write (a one-time migration trimmed 6 historical duplicates), Top Online leaderboard expanded `50 → 100` to match Top Offline, a generated `games/anti-cheat-list.md` plus a `/charts/anti-cheat/list` web page group active games by anti-cheat family, and a new `/charts/delisted` page renders a timeline + reason breakdown of every removed-from-catalogue title. Web app + desktop bumped `1.2.3` → `1.2.4`. Repo public-facing version `3.2.3` → `3.2.4`. Tag `v3.2.4` is GPG-signed; companion desktop tag is `desktop-v1.2.4`.

### 🧹 Dead-script removal

- `scripts/discord_notify.py` deleted — superseded by the `poli0981/.github` reusable workflow; no `.github/workflows/*.yml` or `bash/*.sh` referenced it.
- `scripts/migrate_to_shards.py` deleted — one-shot v2.2 migration tool, completed and unreferenced. The 10-script "unreferenced in workflows" audit confirmed the other eight (`check_dead_links`, `delete_game`, `normalize_genres`, `purge_unhealthy`, `top_offline`, `top_online`, `update_data`, `update_reviews`) all have live `bash/*.sh` wrappers and stay.

### 🪓 Component splits

- `web/src/components/games/EditGameDrawer.tsx` (718 LOC) → 7 focused files under `edit/`:
  - `EditGameDrawer.tsx` keeps the save handler, dialog shell, view-toggle wiring.
  - `EditFormFields.tsx`, `EditJsonView.tsx` (with `JsonDiff`), `EditChangePreview.tsx`, `ViewToggle.tsx` extract the four UI regions.
  - `form-utils.ts` exports `gameToForm` + `formToPatch`; `types.ts` re-exports the `FormState` + `View` types.
- `web/src/components/games/GamesTable.tsx` (568 LOC) → container + 5 files under `table/`:
  - `GamesTable.tsx` keeps the virtualizer (`useVirtualizer` ownership at container level so row-height stays single-source), filters, fuzzy search, sort, and paging.
  - `columns.tsx` extracts the `COLS: ColDef[]` array (12 columns) + `TOTAL_WIDTH` + `SELECT_COL_WIDTH` constants.
  - `TableHeader.tsx`, `TableRow.tsx` (memoised with `React.memo`), `TableToolbar.tsx`, `ExportMenu.tsx` extract the visual regions.
- No behaviour change — same virtual scrolling, same sort/filter wiring, same selection store.

### 📊 New charts

- `web/src/components/charts/TopOfflineBar.tsx` — mirror of `TopOnlineBar` but with offline-tier thresholds (20k/1.5k/300) calibrated to the `top_offline.py` scale instead of the online-only 100k/10k/1k palette. Filters `type_game !== "online" && status === "active"`, top 100 by `current_players`.
- `web/src/pages/TopOffline.tsx` — new page at `/top-offline`, layout mirror of `TopOnlinePage`, registered in `App.tsx` and `Sidebar.tsx` (Trophy icon).
- `web/src/components/charts/AddedPerMonthBar.tsx` — aggregates `records[*].added_at` into `YYYY-MM` buckets, renders an ECharts bar. Added as a third card to the existing `charts/Time.tsx` page alongside `ReleaseYearHistogram` + `AddedCumulativeLine`.

### 🗑️ Removed-games dedup

- `scripts/core/data_store.py` — new `dedup_removed(records)` keeps the latest entry per appid (compared by `removed_at` ISO timestamp, lexicographic order matches chronological for `YYYY-MM-DDTHH:MM:SSZ`). Records without a resolvable appid are dropped.
- `scripts/purge_unhealthy.py:41-43` and `scripts/ingest_new.py:106-108` — both call sites now write `dedup_removed(existing + log)` instead of `existing.extend(log)`. Same `save_jsonl` atomic-rename transaction, so partial writes can't leave duplicates.
- `scripts/dedup_removed_games.py` (new) — one-shot CLI that loads, dedups, and rewrites the file. Run once locally as part of this release; idempotent, safe to re-run.
- Result: existing log trimmed `43 → 37` records. Verified zero duplicate appids post-migration.

### 🏆 Top Online expanded 50 → 100

- `scripts/core/constants.py:81` — `TOP_ONLINE_LIMIT = 100` (was 50). Top Offline already 100.
- `games/top-online.md` regenerated with 100 rows on next workflow tick; format unchanged (10-column table preserved).
- `web/src/pages/TopOnline.tsx` — `<TopOnlineBar limit={100} height={1800}>` to match the new row count.
- i18n strings `topOnline.{subtitle,cardTitle}` updated `Top 50 → Top 100` in both `en.json` and `vi.json`.

### 🛡️ Anti-cheat list

- `scripts/generate_anti_cheat_list.py` (new) — buckets active games by canonical AC name (`ANTI_CHEAT_PATTERNS` keys), with substring-match fallback for free-text values. Unrecognised values land in an `Other` bucket with a stderr warning. Output `games/anti-cheat-list.md`: H1 + TOC + per-family H2 sections, each a 6-column table sorted by `current_players` desc.
- `bash/anti_cheat.sh` + `.github/workflows/anti-cheat-list.yml` (new) — weekly Sunday 06:00 UTC cron + manual dispatch. Uses the same `data-write` concurrency group as the other table-generation workflows.
- `web/src/pages/AntiCheatList.tsx` (new) — `/charts/anti-cheat/list` page mirrors the MD: collapsible per-family sections + sticky AC-name sidebar nav. Uses existing `useGames` hook; canonicalises client-side via a TS port of the Python patterns table. i18n keys `antiCheatList.*` added to en + vi.

### 📉 Delisted charts

- `web/src/hooks/useRemovedGames.ts` (new) — fetches `scripts/removed_games.jsonl` from raw.githubusercontent.com, parses lines, deduplicates client-side (same logic as the Python dedup). TanStack Query with 5-minute staleTime.
- `web/src/components/charts/DelistedTimeline.tsx` (new) — ECharts stacked bar, x = `YYYY-MM` of `removed_at`, stacked by `status_code` (`not_free` / `unavailable` / fallback `other`).
- `web/src/components/charts/DelistedReasonBreakdown.tsx` (new) — ECharts donut by `status_code`.
- `web/src/pages/charts/Delisted.tsx` (new) — `/charts/delisted` page renders both charts. Sidebar nav link with `WifiOff` icon.
- `web/src/components/charts/KpiCards.tsx` — new optional `removedCount` prop; when set, renders a 7th "Removed (all-time)" KPI alongside the existing in-catalog "Delisted" badge. Wired from `Dashboard.tsx` via `useRemovedGames().data?.length`. Grid bumps from `xl:grid-cols-6` to `xl:grid-cols-7`.

### 📝 Docs

- README: removed the duplicate "Quick Links" section (the comprehensive 11-row "Quick links" table at the top covers everything the 4-row duplicate listed).
- README: added `🎯 Top offline (md)` row to the main Quick links table.
- README: version badge bumped `3.2.3` → `3.2.4`.
- i18n: combined `nav.{topOffline,antiCheatList,delisted}`, `topOffline.*`, `antiCheatList.*`, `charts.{time.addedPerMonth,delisted.*}` keys added to `en.json` + `vi.json`.

## [v3.2.3] – 2026-05-17 (The "View Commit Toast + Offline AC Lock" Edition)

Patch release on top of v3.2.2. Three user-reported fixes: the "View commit" action button in success toasts (now reachable + cross-platform), an editor lock that prevents anti-cheat fields from being set on offline games, and a broken `Mark dead games` workflow setup-python step. Web app + desktop bumped `1.2.2` → `1.2.3`. Repo public-facing version `3.2.2` → `3.2.3`. Tag `v3.2.3` is GPG-signed; companion desktop tag is `desktop-v1.2.3`.

### 🍞 View commit toast — clickable + desktop-safe

- Migrated the eight `window.open(commit.htmlUrl, "_blank")` action handlers in `EditGameDrawer.tsx` (2), `Add.tsx` (2 inside `reportToast`), `BulkEditDrawer.tsx` (2), and `BulkActionBar.tsx` (2) to `openExternal()` from `web/src/lib/external-open.ts` — completes the follow-up migration flagged in v3.2.2's CHANGELOG. The Tauri webview was silently blocking the raw `window.open(...)` for external HTTPS URLs, so "View commit" did nothing on desktop.
- Each `toast.success(...)` with a "View commit" action now sets `duration: 15000` (was Sonner's 4 s default). On web the old toasts auto-dismissed before the user could read the description + click the action button.
- Handler now accepts the click event and calls `event.preventDefault()` so the toast stays visible after click (Sonner's default is to dismiss on action click — undesirable when the user wants to glance at the SHA after opening the commit).
- The fix applies to both the initial `toast.success` and the follow-up emit fired by `pollCommitVerification(...).then(...)` (same toast `id`, so `duration` must be set on the update too — otherwise the second emit rebounds to the 4 s default).

### 🔒 Anti-cheat fields lock on offline games

- `web/src/components/games/EditGameDrawer.tsx` — `FormFields` derives `lockAC = form.type_game === "offline"` and threads `disabled={lockAC}` to the AC `<select>`, the custom-AC `<Input>`, the three kernel `<Button>`s, and the AC note `<Textarea>`. A muted hint is rendered under the AC note when locked, explaining how to re-enable.
- `update()` setter now auto-resets `anti_cheat=""`, `anti_cheat_note=""`, `is_kernel_ac="unknown"` when `key === "type_game" && value === "offline"`. This keeps the `formToPatch()` diff honest — switching an online game with AC populated to offline now produces an explicit AC-clear in the commit instead of orphan anti-cheat data on an offline record.
- `web/src/pages/Add.tsx` — same pattern in `OverrideFields` + the `SingleAdd.setOv()` setter. `OverrideFields` combines the existing busy-state `disabled` prop with the new lock via `acDisabled = disabled || lockAC`, so the global "form is submitting" disable still wins. BulkAdd uses raw text / JSON input, so no UI lock needed there.
- `type_game === ""` (unknown) deliberately does **not** lock — only an explicit `"offline"` triggers the gate. The existing `validation.ts` "kernel?" badge rule for online + missing-kernel is untouched.
- New i18n key `edit.acLockedOffline` added to `web/src/i18n/locales/en.json` and `vi.json`, rendered as a `text-xs text-muted-foreground` hint under the AC note when `lockAC` is true.

### 🪦 `Mark dead games` workflow path fix

- `.github/workflows/mark-dead-games.yml` — `cache-dependency-path: scripts/requirements.txt` and the subsequent `pip install -r scripts/requirements.txt` both pointed at a path that doesn't exist. The file lives at the repo root (`requirements.txt`), consistent with the path `codeql.yml:25` already uses.
- Fix: both lines now reference `requirements.txt` at the root. The `setup-python` cache lookup no longer errors with `No file in /home/runner/work/free-steam-games-list/free-steam-games-list matched to [scripts/requirements.txt or **/pyproject.toml]`, and the install step actually finds the deps.
- Workflow is scheduled Mon + Thu 04:30 UTC; the next scheduled run will be the first end-to-end verification, but `workflow_dispatch` with `dry_run=true` is also available for ad-hoc validation.

## [v3.2.2] – 2026-05-11 (The "Bug Fix Quartet" Edition)

Patch release on top of v3.2.1. Four user-reported bug fixes touching the Ctrl+K command palette on desktop, the Health → Games navigation flow, Tauri process-stacking on every launch, and the `type_game` scraper that was defaulting every new game to `"offline"`. Web app + desktop bumped `1.2.1` → `1.2.2`. Repo public-facing version `3.2.1` → `3.2.2`. Tag `v3.2.2` is GPG-signed; companion desktop tag is `desktop-v1.2.2`.

### 🔗 Desktop Ctrl+K external link

- New `web/src/lib/external-open.ts` — lazy-detects the Tauri runtime via `__TAURI_INTERNALS__`, opens external URLs through `@tauri-apps/plugin-shell` on desktop (capability `shell:allow-open` already granted in `web/src-tauri/capabilities/default.json`), falls back to `window.open(url, "_blank", "noopener,noreferrer")` on web/PWA. Plugin module is lazy-imported, so the web bundle never pays for the Tauri code path.
- `web/src/components/common/CommandPalette.tsx` — Ctrl+K game results now route through `openExternal()`. The Tauri webview was silently blocking the raw `window.open(r.link, "_blank")` for external HTTPS URLs, so clicking a search result on desktop did nothing.
- Six other `window.open(...)` call sites (Health workflow link, Add, BulkActionBar, BulkEditDrawer, EditGameDrawer, DeviceFlowPanel) are flagged for follow-up migration to `openExternal()` — same desktop silent-fail will hit them when triggered.

### 🩺 Health → Games filter restoration

- `web/src/pages/Games.tsx` — adds `useSearchParams` + a `useEffect` that mirrors the URL `?search=` parameter into `useFilters.search` on mount. The Health page already linked rows to `#/games?search=<name>`, but Games never read the param, so the table stayed unfiltered and the Topbar input stayed empty. The store binding to Topbar means visual feedback is automatic once the filter is set.
- Guard `if (term !== null)` (instead of `if (term)`) lets `?search=` explicitly clear the filter — useful for shareable "no filter" links.

### 🪟 Tauri single-instance enforcement

- `web/src-tauri/Cargo.toml` — adds `tauri-plugin-single-instance = "2"` under the existing desktop-only `cfg(not(any(target_os = "android", target_os = "ios")))` block, matching the updater plugin's gating pattern.
- `web/src-tauri/src/lib.rs` — registers single-instance as the **first** plugin so it short-circuits duplicate launches before any other state initialises. The dup-launch callback calls `unminimize()` + `show()` + `set_focus()` on the existing `main` window. Without this, every Start-menu / shortcut / file-association invocation spawned a fresh `f2p-tracker.exe` that lingered in Task Manager.
- No capability changes needed — plugin runs entirely Rust-side, no frontend command exposed.

### 🎮 `type_game` online inference

- `scripts/core/fetcher.py` — new `_infer_type_game(categories)` reads `data.get("categories", [])` and returns `"online"` when any description contains `online`, `mmo`, `massively multiplayer`, `cross-platform multiplayer`, or `multi-player`. Pure `shared/split screen` descriptions are treated as local-only and skipped unless paired with another online signal.
- Wired into `apply_details()` next to the existing anti-cheat category loop, guarded by `is_empty(game.get("type_game"))` so manual prefills in `temp_info.jsonl` remain authoritative — the `MANUAL_FIELDS` merge in `data_store.merge_extension_data()` and the override re-apply in `ingest_new.py` are unchanged.
- The legacy default-to-`"offline"` at the end of `fetch_full()` stays as the final safety net for games with no multiplayer signal in Steam categories. New ingests of online F2P games now classify correctly instead of all-offline.

## [v3.2.1] – 2026-05-11 (The "Genre Cleanup" Edition)

Patch release on top of v3.2.0. Normalizes inconsistent `genre` values across the dataset (31 records, 10 canonical mappings) and broadens the webapp's genre combobox with 14 additional suggestions. Web app + desktop bumped `1.2.0` → `1.2.1`. Repo public-facing version `3.2.0` → `3.2.1`. Tag `v3.2.1` is GPG-signed; companion desktop tag is `desktop-v1.2.1`.

### 🧹 Genre normalization script

- New `scripts/normalize_genres.py` — local one-shot tool with `--apply` flag (dry-run by default). Reuses `core.data_store.load_main` / `save_main` so writes are atomic + sharded.
- Canonical mappings applied (sentence-case style for compounds): `Hack and Slash` → `Hack & Slash` (4), `Third-Person Shooter` → `Third-person Shooter` (7), `Top-Down Shooter` → `Top-down Shooter` (3), `Turn-Based Strategy` → `Turn-based Strategy` (3), `Turn-Based Tactics` → `Turn-based Tactics` (4), `Turn-Based Combat` → `Turn-based Combat` (2), `Shoot 'Em Up` / `Shoot'em up` → `Shoot 'em up` (5), `Point-and-Click` → `Point & Click` (1), `Rougelite` → `Roguelite` (2 typo).
- 31 records updated · 10 unique canonical changes · unique-genre count 100 → 92.
- Idempotent — second run reports "data already canonical".
- Comma-separated values like `"Action RPG, Gacha"` (Wuthering Waves, Honkai Impact 3rd) are flagged in a "Manual review needed" section rather than auto-split, since the schema is single-genre.
- All `games/*.md` regenerated via `scripts/generate_tables.py`; affected genre files include the new sentence-case slugs (`turn-based-strategy.md`, `top-down-shooter.md`, `third-person-shooter.md`, `roguelite.md`, etc.).

### 🎛 Webapp genre dropdown additions

- `web/src/lib/enums.ts` — `GENRE_ENUM` extended from 44 → 58 entries. Added 14 sub-genres already common in the data: `Action RPG`, `Beat 'em up`, `Bullet Hell`, `Clicker`, `Hidden Object`, `Real-Time Strategy`, `Roguelite`, `Survival Horror`, `Tactical RPG`, `Third-person Shooter`, `Top-down Shooter`, `Turn-based RPG`, `Turn-based Strategy`, `Turn-based Tactics`.
- Sentence-case style matches the normalized data values.
- Dropdown filter on `web/src/pages/Games.tsx` is facet-driven (auto-updates from the records), so it now shows the deduplicated canonical names. The `EditGameDrawer` combobox suggests the 14 new entries while still accepting free-text input.

## [v3.2.0] – 2026-05-11 (The "SEO + Donate + Auto-Discussion + Health Polish + Dev Docs" Edition)

Single-PR bundle (#64) shipping eight features on top of v3.1.0. Web app + desktop bumped from `1.1.0` → `1.2.0`. Repo public-facing version `3.1.0` → `3.2.0`. Tag `v3.2.0` is GPG-signed; companion desktop tag is `desktop-v1.2.0`.

### 🔍 SEO basics

- `web/index.html` — full Open Graph block (`og:type`, `og:title`, `og:description`, `og:url`, `og:image`, `og:site_name`, `og:locale` + alternate), Twitter Card (`summary`), `<link rel="canonical">`, `meta name="author"`, JSON-LD (`WebSite` + `Person` + `SoftwareApplication`).
- New `web/public/robots.txt` (allow all + sitemap pointer) and `web/public/sitemap.xml` (5 entries: site root, GitHub repo, all-games / top-online / changelog markdown).
- New hook `web/src/hooks/useDocumentTitle.ts` — sets `document.title` to `<page> · Steam F2P Tracker` and re-runs on language change. Wired into all 18 routes (Dashboard / Games / TopOnline / Health / Activity / Add / About / Donate / Settings / 9 charts).
- VitePWA already emits `manifest.webmanifest` from `vite.config.ts`; no manual manifest needed.

### 💬 Auto-create GitHub Discussion on release

- New `.github/workflows/announce-release-discussion.yml` — fires on `release: published` (plus `workflow_dispatch` with a `tag` input for re-runs).
- Implemented via `actions/github-script@v8` + GraphQL `createDiscussion` (REST has no equivalent).
- Resolves the discussion category by slug — defaults to `Announcements`, falls back to `General` with a logged warning, then to the first available category.
- **Idempotent**: a GraphQL search runs first; if a discussion with the same title exists, the workflow skips with `core.notice()` and returns the existing URL via output. Re-running `workflow_dispatch` is therefore a no-op.
- Permissions: `contents: read`, `discussions: write` — both granted by `GITHUB_TOKEN` defaults once Discussions is enabled on the repo.

### 💖 Donate page

- New `web/src/pages/Donate.tsx` route at `/donate` — grid of 5 platform cards (GitHub Sponsors, Ko-fi, Buy Me a Coffee, Patreon, PayPal) sourced from `.github/FUNDING.yml`.
- Each card has a tinted icon ring, label, short description, and an "Open" button (`target="_blank" rel="noopener noreferrer"`).
- New nav item in `web/src/components/layout/Sidebar.tsx` SECONDARY group (between About and Settings); `Heart` icon from lucide.
- Full EN + VI i18n keys under `donate.*` (title / subtitle / cta / footnote + per-platform label & desc).

### 📖 Dev docs

- New `docs/pc_spec.md` (EN) + `docs/i18n/vi/pc_spec.md` (VI) — maintainer hardware spec mirroring `E:\spec.txt` (CPU / GPU / RAM / IDE) plus iPhone test-device list.
- New `docs/dev_env.md` (EN) + `docs/i18n/vi/dev_env.md` (VI) — IDE map (PyCharm / WebStorm / RustRover 2026.x), toolchain table (Python 3.12 / Node ≥ 22 / Rust stable / Tauri 2), per-area dev workflow (web / Tauri / Python pipeline), Git + GPG conventions, branch + PR flow.
- New `web/src-tauri/TAURI.md` — desktop build prerequisites (incl. CI's exact `apt-get` line), local + production build commands, signing + auto-update notes, troubleshooting.
- `AUTHORS.md` — new "Dev info" table (GitHub handle, IDE channel, toolchain versions, link map to all the above).
- README "Docs" section — links the four new docs.

### 🤖 Telegram bot user-guide pointer

- New `docs/telegram-bot.md` — one-page pointer to the external [`telegram-scraper-bot/docs/USER_GUIDE.md`](https://github.com/poli0981/telegram-scraper-bot/blob/main/docs/USER_GUIDE.md), bot source repo, plus a paragraph each on what the bot does and the whitelist lifecycle.
- `CONTRIBUTING.md` — section 3 (`@my_skull_bot`) gets a 3-line callout with the user guide link, bot source URL, and the new in-repo summary doc.
- `web/src/pages/About.tsx` — Maintainer card's privacy note now includes a "Bot user guide & source" sub-card with the same three links.

### 🩺 Health bucket split

- `web/src/pages/Health.tsx` — `gatherIssues()` adds a fifth `IssueGroup`: `OnlineAcUnknown` for games with `type_game === "online"` and `anti_cheat ∈ {"", "-"}`. Previously these games were silently dropped from all categories; now they have a discoverable home.
- Edge-case fix: the existing "Kernel" filter compared `(r.anti_cheat ?? "-") !== "-"`, missing the empty-string case. Both filters now use a normalised `(r.anti_cheat ?? "").trim()`.
- `ShieldQuestion` icon (lucide). EN + VI i18n keys: `health.groupOnlineAcUnknown` + `…Desc`.

### 🎮 Steam Desktop direct link

- New helper `web/src/lib/steam-link.ts` — `steamProtocolUrl(appid)` returns `steam://store/<appid>`, `steamWebUrl(appid)` returns the regular HTTPS store URL.
- `web/src/components/games/GameDetailDrawer.tsx` — single store link replaced by two buttons rendered side-by-side: a primary "Steam Desktop" (`steam://`) and an outline "Web" (`https://`). Tooltip on the desktop button explains the fallback path.
- Works in both web build (browser shows protocol prompt if Steam is installed, silent fail otherwise — Web button is the safety net) and Tauri build (Tauri 2 allows `steam://` navigation by default; no allow-list change needed).
- EN + VI i18n: `detail.openOnSteamDesktop`, `detail.openOnSteamDesktopHint`, `detail.openOnSteamWeb`.

### 🛌 Bi-weekly offline-player leaderboard

- New `scripts/top_offline.py` — clones the `top_online.py` shape but filters `_is_offline(g)` (non-empty `type_game ≠ "online"`). Emits `games/top-offline.md` (top 100 single-player F2P concurrents, 10-column format identical to top-online).
- Calibrated tier thresholds (`_TIERS`) lower than online (offline games rarely break 6-figure concurrents) — `🔥 Mega ≥ 20k`, `⭐ Hot ≥ 5k`, `🟢 Healthy ≥ 1.5k`, `🟡 Stable ≥ 300`, `🟠 Low ≥ 50`, `🔴 Quiet ≥ 10`, `💀 Idle <10`.
- New `bash/offline.sh` matches the shape of `bash/online.sh` (pip install requests → run script → conditional commit).
- New `.github/workflows/top-offline.yml` — cron `0 5 1,15 * *` (1st + 15th of each month at 05:00 UTC) plus `workflow_dispatch`. Shares the unified `data-write` concurrency group.
- Health page (`web/src/pages/Health.tsx`) — new manual trigger button "Top offline" (next to the existing "Top online" trigger).
- **Bug fix during implementation**: `scripts/core/fetcher.py:update_players_only()` had a hardcoded `type_game == "online"` filter that would have made the offline workflow refresh zero rows. Extended with a `type_filter` kwarg (`"online"` default for backward compat, `"offline"`, or `"all"`); `top_offline.py` passes `type_filter="offline"` (excludes both online and empty/unclassified type).

### 🔢 Versioning

| Surface | Old | New |
|---|---|---|
| Repo public-facing | 3.1.0 | **3.2.0** |
| `web/package.json` | 1.1.0 | **1.2.0** |
| `web/src-tauri/Cargo.toml` | 1.1.0 | **1.2.0** |
| `web/src-tauri/tauri.conf.json` | 1.1.0 | **1.2.0** |
| Git tag (signed) | `v3.1.0` | `v3.2.0` |
| Desktop tag (signed) | `desktop-v1.1.0` | `desktop-v1.2.0` |

---

## [v3.1.0] – 2026-05-09 (The "Less CI Noise, Lighter Images, Dead-Game Detection" Edition)

Four PRs landed in this release plus a refresh of the docs and the contributor surface around the new Telegram bot. Web app + desktop app bumped from `1.0.0` → `1.1.0`. Repo public-facing version `3.0.1` → `3.1.0`. Tag `v3.1.0` is GPG-signed; companion desktop tag is `desktop-v1.1.0`.

### 🛠️ CI hygiene — notify wrappers (#60)

- The 3 notify wrappers (`notify-ci-failure`, `notify-deploy`, `notify-release-pipeline`) used to trigger on `workflow_run: workflows: ["*"]` and were filtered out by their reusable callee's `if:` — 95–100 % of runs showed as "skipped". Replaced the catch-all with explicit lists of source workflow `name:` strings per wrapper, plus job-level `if:` to short-circuit non-matching conclusions. Drops skip rate to <10 %.
- Trade-off documented in each file: renaming a source workflow's `name:` field silently breaks notifications; comment warns about the coupling.

### 🖼️ Image optimisation — capsule swap + WebP via wsrv.nl (#61)

- `scripts/generate_tables.py:68` — markdown thumbnails now use `capsule_184x69.jpg` instead of `header.jpg` (~80 % bandwidth reduction at the same 120 px render width).
- Web app `GamesTable` + `CommandPalette` — capsule swap with explicit `width`/`height` to eliminate CLS, plus `onError` fallback to `header.jpg` for the ~5 % of games without a capsule variant.
- `GameDetailDrawer` — `<picture>` element with WebP source via `images.weserv.nl` proxy + JPEG fallback. Lazy-loaded, explicit dimensions.
- `vite.config.ts` — new `CacheFirst` runtime cache for `images.weserv.nl` (`statuses: [200]` only — opaque 0-status would cache proxy errors).
- New helper `web/src/lib/image.ts` — `headerToCapsule()` + `webpProxyUrl()`.

### 💀 Dead-game detection — `mark-dead-games.yml` (#62)

- New cron `Mon + Thu 04:30 UTC` flags **online games released >1 year ago** whose `current_players == 0` for **≥14 days** (configurable via `DEAD_GAME_DAYS` env or `--days` CLI). On trigger: `is_dead = true` + `"💀 Dead game"` appended to `notes` (idempotent).
- **State model**: ISO timestamp `zero_player_since` (robust against schedule drift), not a streak counter.
- **Mark mechanism**: additive `is_dead: bool` + note. `status` stays `"active"` so the existing enum / Top Online filter / chart groupings don't break. Web app gains a "Hide dead" filter toggle and a 💀 emoji prefix on dead rows.
- **Dry-run available**: `python scripts/mark_dead_games.py --dry-run --days 0` for auditing without writes.
- New helper `append_note_idempotent()` in `scripts/core/data_store.py`. Retrofitted onto `check_dead_links.py` to fix duplicate `"💀 Delisted"` accumulation on reruns.
- Schema migration via `_SKELETON_TEMPLATE` only (no one-shot script). Both the Python pipeline and the React app inherit defaults via existing `migrate_record()` / `migrateRecord()` loops.

### 🔄 Concurrency unification

All data-mutating workflows now share `concurrency: { group: data-write, cancel-in-progress: false }`:

- `update-json`, `update-daily`, `top-online`, `update-reviews`
- `check-dead-links`, `purge-unhealthy`, `mark-dead-games` (new)
- `ingest-new`, `ingest-from-issue`, `bot-ingest`, `refetch-all`

Prevents races on `git push` to `data/` shards. Bot-ingest moved from its own `bot-ingest` group to the unified group.

### 📝 Docs + contributor surface (this PR)

- **`AUTHORS.md`** at repo root — handle map for the maintainer, AI-assistant disclosure, MIT licensing reminder.
- **`username.txt`** extended with `telegram bot`, `telegram user`, and `email` lines (canonical machine-readable handle map mirrored by `AUTHORS.md`).
- **`assets/qr/`** — QR-code PNGs for `@my_skull_bot` and `@SkullMute0011` (mirrored to `web/public/qr/` so the SPA can serve them). Generated via `python -m qrcode`.
- **`web/src/pages/About.tsx`** — Maintainer card now lists Telegram bot + Telegram DM (with QR thumbnails inline) + Email. New "Telegram QR codes" card with full-size scannable codes. Privacy note about Telegram `user_id` handling.
- **`CONTRIBUTING.md`** rewrite — adds the `@my_skull_bot` flow as a first-class contribution path (find `user_id` → DM maintainer privately → whitelist → run when bot's online → follow prompts). Loud privacy warning at the top.
- **`docs/PRIVACY_POLICY.md`** — new "Telegram bot" section covering the `user_id` data flow, where it's stored, retention/removal, and the maintainer's commitment.
- **`docs/ToS.md`** — new section 5.1 "Sharing personal information when contributing" with non-negotiable rules about private vs public channels.
- **`docs/Contact.md`** — Telegram bot + DM entries added at the top.
- **README** badges and feature list refreshed (version bumped, dead-game workflow listed, About-page QR card mentioned).

### 🔢 Versioning

| Surface | Old | New |
|---|---|---|
| Repo public-facing | 3.0.1 | **3.1.0** |
| `web/package.json` | 1.0.0 | **1.1.0** |
| `web/src-tauri/Cargo.toml` | 1.0.0 | **1.1.0** |
| `web/src-tauri/tauri.conf.json` | 1.0.0 | **1.1.0** |
| Git tag (signed) | `v3.0.1` | `v3.1.0` |
| Desktop tag (signed) | `desktop-v1.0.0` | `desktop-v1.1.0` |

---

## [v3.0.1] – 2026-05-07 (The "Desktop Actually Ships This Time" Edition)

Same-day post-v3.0.0 maintenance covering Phase 9 (auto-update foundations + CVE bumps + Device Flow scaffold), Phase 10 (Tauri build break + i18n full coverage + deps audit), and Phase 10.1 (minisign keypair rotation). The desktop release pipeline is now end-to-end green — `desktop-v1.0.0` finally produces signed `.msi` / `.exe` / `.dmg` / `.AppImage` / `.deb` / `.rpm` artefacts with a valid `latest.json` for auto-update.

### 🖥️ Phase 9 — auto-update foundations (#56)

- `tauri-plugin-updater` wired into `web/src-tauri/`. Endpoint pinned to the Releases page so installed clients fetch `latest.json` on launch.
- Updater pubkey embedded in `tauri.conf.json` (gated behind a no-op for mobile builds via `#[cfg(not(any(target_os="android", target_os="ios")))]`).
- GitHub Device Flow scaffold added to Settings: signed-in users no longer have to paste a long-lived PAT — they kick off `https://github.com/login/device`, type the user_code, and the app polls until token issuance. Falls back to PAT for the offline path.
- Dependency CVE bumps (vite 5 → 7, vite-plugin-pwa 0.20 → 1.x). Path-traversal fix in source-map handling. No source changes required for the bumps.
- More i18n: a chunk of edit-drawer / activity / dashboard chrome got proper translation keys.

### 🛠️ Phase 10 — Tauri build break + full i18n + deps audit (#57)

- **Tauri lib-name regression fixed.** Phase 9's auto-updater work introduced a `f2p_tracker_lib::run()` call in `main.rs` without declaring `[lib]` in `Cargo.toml`. Cargo's implicit lib name is `f2p_tracker` (hyphens → underscores from the package name) so the call failed to resolve and `cargo build` blew up. Added the explicit Tauri-2-template-style block:
  ```toml
  [lib]
  name = "f2p_tracker_lib"
  crate-type = ["staticlib", "cdylib", "rlib"]
  ```
  The triple crate-type keeps the door open for future `tauri ios init` / `tauri android init` work that `lib.rs`'s `#[cfg_attr(mobile, tauri::mobile_entry_point)]` already implies.
- **i18n now reaches every chrome surface** (~150 new keys across new namespaces `charts`, `activity`, `add`, `system`, `cmdk`, `about`, `bulk`, `detail`, `diff`, `dialogs`, `health`). All 9 chart pages, Activity, Add, Health, Top Online, About headings, drawers (Edit / BulkEdit / Diff / GameDetail), `PwaIndicator`, `QueryState`, `GpgQuickUnlock`, `Topbar` tooltips/aria-labels, `Settings` rate-limit panel, `BulkActionBar` confirm dialog, `GamesTable` tooltips, and `CommandPalette` resolve through `useTranslation`. Long-form About prose stays English per the `settings.languageHint` policy. Enum values (anti-cheat / genre / type_game / safe) stay dataset-stable.
- **Third-party deps audit.** Walked `web/package.json` against `About → Stack & third-party` and `docs/ACKNOWLEDGEMENTs.md`. Added missing entries: `react-router-dom`, the i18next stack (`i18next` + `react-i18next` + `i18next-browser-languagedetector`), Tauri 2 + plugins (shell / updater / process), `echarts-for-react`, the styling utilities (`class-variance-authority` / `clsx` / `tailwind-merge` / `tailwindcss-animate`), and PostCSS + autoprefixer. Vite version corrected 5 → 7 (was already bumped by Phase 9; About just hadn't caught up).
- `ACKNOWLEDGEMENTs.md` restructured into grouped sections (runtime/build, styling, UI primitives, routing & i18n, data & state, charts, crypto & PWA, desktop) with deep links + SPDX licences.
- `web/src-tauri/Cargo.lock` now committed for reproducible desktop builds.

### 🔑 Phase 10.1 — minisign keypair rotation (#58)

- `desktop-v1.0.0` was failing at the final sign-updater-bundle step:
  ```
  failed to decode secret key: incorrect updater private key password:
                                Missing comment in secret key
  ```
  minisign formats the error so the inner "Missing comment" is the symptom of a wrong password — when the password is wrong, decryption returns garbage and the expected `untrusted comment: minisign encrypted secret key` header bytes don't appear. The original keypair's password was lost, so the GH secret could no longer decrypt the key.
- Re-keyed via `npx tauri signer generate --ci -p ""` with no password. Stored at `~/.tauri/f2p-tracker{,.pub}` on the maintainer's box; `web/src-tauri/.gitignore` extended (`*.key`, `f2p-tracker{,.pub}`) as a guardrail in case keys ever land in `src-tauri/` during dev.
- New pubkey baked into `tauri.conf.json` `plugins.updater.pubkey`. GH secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` rotated via `gh secret set` (password = empty string).
- **Trade-off**: any user already on a build signed with the old key would have their auto-update break. Nobody hit that path because Phase 9 / Phase 10 release runs both failed before publishing artefacts. Phase 10.1's rebuild is the first actually-shipped `desktop-v1.0.0`.

### 🏷️ Tag handling

- `desktop-v1.0.0` was force-pushed twice in this cycle as the workflow input commit advanced (Phase 9 → Phase 10 → Phase 10.1). The triggering tag is GPG-signed each time. Once the auto-update story is real users-on-it, future fixes should bump `desktop-v1.0.x` instead of force-pushing.

### 📝 Docs (this release)

- `CHANGELOG.md` — this entry.
- `web/src-tauri/Cargo.toml` + `tauri.conf.json` + `.gitignore` — Phase 10 / 10.1 changes documented in their own commit messages and PR bodies (#57, #58).

---

## [v3.0.0] – 2026-05-07 (The "It Has a Website Now" Edition)

The repo is no longer just a list. It is a **list + a React/Vite web app + a Tauri desktop app**, all reading the same Python-pipeline-maintained data.

### 🌐 Web app — `web/` + GitHub Pages

Built across phases 1 → 7. Live at <https://poli0981.github.io/free-steam-games-list/>.

- **Phase 1** — read-only browse: virtualised 1.2k-row TanStack table, faceted filters, Fuse.js fuzzy search, 4 ECharts MVP charts (KPI, top-online, genre treemap, platform donut), GitHub Pages deploy via `actions/deploy-pages`.
- **Phase 2** — PAT-based GitHub auth, single-record edit drawer for the 8 manual fields, diff viewer, single + bulk Steam-link queue into `scripts/temp_info.jsonl`, conflict-retry, sonner toasts.
- **Phase 3** — client-side OpenPGP signing via Git Data API: switched all writes from Contents API to `commitFile(getHead → createBlob → createTree → buildCommitContent → openpgp.sign → createCommit → updateRef)`. Settings panel with passphrase unlock + lock indicator. Earlier claim that PATs auto-sign was wrong — Contents API commits land Unverified.
- **Phase 4** — fixed GPG salt-notation incompatibility (`config.nonDeterministicSignaturesViaNotation: false`) so OpenPGP.js v6 signatures parse on GitHub. Bulk edit + bulk delete in one signed multi-shard commit. 8 remaining charts (tags wordcloud, AC stacked, languages heatmap, release-year histogram, catalog-growth cumulative line, reviews histogram, online player tiers pie, DRM/DLC bars). Health page with workflow_dispatch buttons. ⌘K command palette (cmdk).
- **Phase 4.1** — GPG signature payload fix: dropped trailing `\n` after the commit message so our signed bytes match `verification.payload` byte-for-byte. Verified via `gh api .../commits/{sha}.commit.verification.reason → valid`.
- **Phase 5** — PWA (installable, offline shell + last-known data via Workbox), GPG identity override (multi-UID picker), GPG idle auto-lock 5/15/30/60 min, Activity feed page (`/activity`) with Verified-status badges + Me/Bots/All filters.
- **Phase 6** — curated enums (`ANTI_CHEAT_ENUM`, `GENRE_ENUM`) + dropdowns, JSON-editor toggle in the edit drawer (full-record replace), manual-field overrides on Add (single + bulk JSON mode propagates `genre/type_game/anti_cheat/notes/safe` straight into `temp_info.jsonl`), GamesTable pagination 50/100/200/500/all + hidden scrollbar + per-row validation badge, per-game permalinks `/games/:appid` with friendly 404 drawer, verify-after-commit polling (toast updates with `verification.reason` once GitHub confirms), CSV/JSON export of the filtered subset, About page (repo + dev info from `username.txt` + 3rd-party stack + issue templates), topbar GPG quick-unlock popover, owner-gate (`useIsOwner` + `OWNER_LOGIN`) hides edit/add/delete UI from non-owners.
- **Phase 6.1** — Edit Always Failing fix: Contents API caps `content` at 1 MB; `data/data_001.jsonl` is 1.49 MB so the read came back empty and every edit threw "Record not found". New `getRepoFileText()` helper falls back to the `/git/blobs/{sha}` endpoint for oversize files.
- **Phase 6.2** — stale-after-edit fix: bumped `data/index.json.last_updated` in every shard-modifying commit AND switched the SW cache to `NetworkFirst` (raw.github CDN is Fastly-cached for 5 min). Plus optimistic-update helpers (`optimisticEdit/Replace/BulkEdit/BulkDelete`) write straight to TanStack + IndexedDB so the editor sees their own change instantly without waiting for the CDN.
- **Phase 7** — date-column sort fix (`parseReleaseDate`), hamburger mobile nav (Sheet drawer, auto-close on route change), About expansion (Heads-up caveats + AI disclosure + legal links + per-third-party SPDX licence badges), legal docs rewritten (DISCLAIMER + EULA + ToS + PRIVACY) with the four caveats from `notes.txt` (genre best-effort, English-only, test-data leakage, unsigned-commit dev artefacts), refreshed `bug_report.yml`, workflow Node 20 → 24 + actions versions bumped.

### 🌍 i18n — vi / en (Phase 8, this release)

- `react-i18next` + `i18next-browser-languagedetector`. Resource files `src/i18n/locales/{en,vi}.json`.
- Auto-detect from `navigator.language` on first load; persistent override via Settings → Language.
- Sidebar nav, Topbar, Settings, Dashboard, Top Online, common buttons, common toast strings translated. Long-form legal copy stays English by design (legal review hard to mirror exactly across two languages).

### 🖥️ Desktop app — Tauri 2 (Phase 8, this release)

- `web/src-tauri/` Rust scaffold targeting Tauri 2. Single `main` window, fixed 1400 × 900, no resize, no maximise, dark theme, centred at startup.
- `tauri-plugin-shell` for opening external links to Steam / GitHub from the embedded UI.
- New `release-desktop.yml` workflow: matrix `ubuntu-latest` / `windows-latest` / `macos-latest`, Apple Silicon + Intel universal binaries, `tauri-apps/tauri-action`. Triggered by `desktop-v*` tags or manual workflow run. Each run creates a draft GitHub Release with `.msi` / `.dmg` / `.AppImage` / `.deb` assets.
- `npm run tauri:dev` and `npm run tauri:build` from `web/` for local builds.

### 📦 Versioning

- Repo version badge **2.1.0 → 3.0.0**.
- `web/package.json` **0.1.0 → 1.0.0** (web app considered first-stable).
- `web/src-tauri/Cargo.toml` and `tauri.conf.json` ship at `1.0.0`.

### 📝 Docs (this release)

- `README.md` — rewrite: web app + desktop sections, updated Quick Links table, new architecture diagram, refreshed contribute paths, refreshed docs index.
- `CHANGELOG.md` — this entry consolidating phases 1 → 8.
- `docs/ACKNOWLEDGEMENTs.md` — refreshed with phase-by-phase AI assistance breakdown (Grok v1; Claude for v2 + the entire web/desktop layer + this changelog).
- `web/README.md` — phase 8 status appended.

### 🛠️ Pipelines unchanged

- All 9 v2.x Python pipeline workflows (update-json, generate-tables, top-online, update-reviews, dead-link-check, purge-unhealthy, ingest-new, ingest-from-issue, refetch-all) keep their schedules and behaviour. Two new workflows added: `deploy-pages.yml` (Phase 1) and `release-desktop.yml` (Phase 8).

---

## [v2.1.0] - 2026-03-28 (The "Extension-Ready + Performance" Edition)

### 💥 Breaking Changes

- `desc` field **removed** from schema. Use `description` only. Migration script handles upgrade automatically.
- `free_type` field removed (unreliable from API, extension handles classification client-side).
- `jsonlines` pip dependency dropped – all I/O now uses stdlib `json` (faster, zero deps).
- `fetcher.py` function renamed: `_process_batch()` → `process_batch()` (public API).

### 🏗️ Schema v2.1 (Extension-Compatible)

- **7 new fields** added to every game record, matching Chrome extension output:
    - `publisher` (list) – e.g. `["Square Enix", "Feral Interactive (Mac)"]`
    - `platforms` (list) – e.g. `["Windows", "macOS", "Linux"]`
    - `languages` (list) – e.g. `["English", "French", "Japanese"]`
    - `language_details` (list[dict]) – per-language `{name, interface, audio, subtitles}` booleans
    - `tags` (list) – all user-defined Steam tags including hidden overflow
    - `anti_cheat_note` (str) – raw anti-cheat name from store page
    - `is_kernel_ac` (bool|null) – `true` = kernel-level, `false` = non-kernel, `null` = unknown
- `developer` normalized: string → list everywhere (API, extension, migration).
- `desc` merged into `description`, then dropped. One field, no duplication.

### 🔌 Extension Data Integration

- New `merge_extension_data()` in `data_store.py` – smart merge with 3-tier priority:
    - **MANUAL_FIELDS** (notes, safe, type_game, genre, anti_cheat): only fill if empty (preserves user edits).
    - **ARRAY_FIELDS** (developer, publisher, platforms, languages, tags): replace wholesale (extension data is richer).
    - **Other fields**: overwrite if extension provides non-empty value.
- `ingest_new.py` now accepts full extension output (20+ fields per entry) – merges before fetch, re-applies manual
  overrides after fetch.
- Ingest summary shows field counts: `dev=DONTNOD plat=[Windows, macOS, Linux] langs=6 tags=20`.

### 🔍 HTML Scraper (New Module)

- New `scraper.py` – extracts data unavailable from Steam API:
    - **Language table**: parses `<table class="game_language_options">` → accurate Interface/Audio/Subtitles per
      language (API only gives a broken HTML string with no subtitle info).
    - **DLC pricing**: parses `#gameAreaDLCSection` → checks `data-price-final` per DLC row. Only marks
      `has_paid_dlc=true` if at least one DLC has actual non-zero price (API just lists DLC IDs with no prices).
    - **Tags**: parses `.app_tag` elements including `display:none` overflow tags (API `appdetails` doesn't return user
      tags at all).
- All 3 extracted from **single GET request** to store page – one HTML fetch per game, not three.
- 8 regex patterns pre-compiled at module level.

### ⚡ Performance Optimizations

- **Eliminated double-fetch in ingest**: `health_checker` now caches API response in `HealthResult.data`.
  `ingest_new.py` passes `prefetched_details=health.data` to `fetch_full()` → skips redundant `fetch_app_details()`
  call. Saves 1 API request per game (300 games = ~450s saved).
- **Dropped jsonlines dependency**: `load_jsonl()` uses `json.loads()` line-by-line, `save_jsonl()` uses
  `json.dumps()` + `f.write()` directly. ~20-30% faster I/O for large files, zero pip deps for core.
- **Pre-compiled regex**: `scraper.py` compiles all 8 patterns at import time, not per-call. 300 games = 8 compiles
  instead of 2400.
- **Faster `is_empty()`**: uses `frozenset` lookup for empty string variants, early returns for `None`/`list`.
- **`SteamClient.__slots__`**: reduced memory per instance, faster attribute access.
- **`extract_appid()` regex simplified**: `/app/(\d+)` instead of full domain match – shorter, same correctness.
- **`make_skeleton()` template**: shallow-copies from frozen template dict instead of building from scratch.
- **`generate_tables.py`**: `lines.extend(generator)` instead of `append()` loop.

### 🔄 New Scripts & Workflows

- `refetch_all.py` + `refetch-all.yml` – **manual-only** force re-fetch of ALL games into v2.1 schema. Creates backup →
  migrates → clears fetchable fields → re-fetches from Steam API + HTML scrape. Preserves manual fields (notes, safe,
  type_game). Requires typing `"yes"` to confirm. Timeout: 120 minutes.
- `migrate_schema.py` + `migrate-schema.yml` – upgrades existing `data.jsonl` records: adds missing fields, normalizes
  types, drops deprecated fields. Idempotent.

### 🐛 Bug Fixes

- **`languages` corrupted**: API HTML string `"Brazil<br>languages with full audio"` was parsed as
  `"Brazillanguages..."`. Fixed by switching to HTML table scraping.
- **`subtitles` always `false`**: API has no subtitle breakdown. Fixed by parsing store page language table (
  Interface/Audio/Subtitles columns).
- **`has_paid_dlc` false positives**: Games with free-only DLC were marked `true`. Fixed by scraping actual
  `data-price-final` attributes.
- **`description` duplicated**: Both `desc` and `description` stored same text. Unified to `description` only.

### 🧹 Improved

- Tables: Publisher column, Platforms column, Language count, kernel anti-cheat badge (🔴/🟢).
- `health_checker.py`: `@dataclass(slots=True)` for leaner objects.
- `top_online.py`: tier thresholds as tuple list (cleaner).
- All scripts: consistent `sys.path.insert(0, ...)` for imports.

---

## [v2.0.0] - 2026-03-26 (The "Finally Got Serious" Edition)

### 💥 Breaking Changes

- Data format migrated from `data.json` to `data.jsonl` (JSON Lines).
- All Python scripts rewritten from scratch under `scripts/core/` modular architecture.
- Bash scripts rewritten with `set -euo pipefail`.

### 🏗️ Architecture (Complete Rewrite)

- Modular core: `constants.py`, `steam_client.py`, `data_store.py`, `fetcher.py`, `health_checker.py`.
- Rate-limited HTTP client with backoff, retry, 429 handling, session pooling.
- Health detection (5 statuses), purge, dead link check, pre-flight ingest validation.
- New ingest flow: `temp_info.jsonl` → validate → dedup → health check → fetch → `data.jsonl`.
- 9 CI/CD workflows. Metacritic, DRM, Peak Today, Status columns. Top Online leaderboard with trends.

---

## [v1.1.2] - 2026-01-11

- 40+ games added.

## [v1.1.1] - 2026-01-07

- 50+ games, delete/dedup scripts, CSV export, auto CSV Actions. (by [@poli0981](https://github.com/poli0981))

## [v1.1.0] - 2025-12-30 (Scale Noob Edition)

- Split all-games.md into parts. Smart fetch skip. Wiki. Issue templates.
- Batch + delay optimize for 500+ games. Various Action fixes.

Previous: [v1.0.0] – Initial stable.

Made with boredom, instant noodles, sale addiction, and AI power ✨