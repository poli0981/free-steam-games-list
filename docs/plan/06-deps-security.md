# deps-security track — design

## 0. Corrections to the briefing (verified against the tree)

| Briefing claim | Reality |
|---|---|
| "there is no Cargo.lock in the working tree" | **False.** `E:\2\web\src-tauri\Cargo.lock` exists (144 KB) and is **git-tracked** (`git ls-files` confirms). Dependabot alert #18 scans exactly this path. |
| "echarts is LOCKED at 5.6.0 while package.json declares ^6.1.0 — node_modules/lockfile are out of sync with the manifest" | **Half false.** `web/package-lock.json` already resolves `node_modules/echarts` → **6.1.0**. Only the *local* `node_modules/` on this machine is stale at 5.6.0. CI (`npm ci`) already ships echarts 6 to production today. The real problem is a **peer conflict** (below). |
| "@apply usages in index.css and command-palette.css" | `src/components/common/command-palette.css` contains **zero** Tailwind directives — it is plain CSS using `hsl(var(--…))`. All 5 `@apply` sites are in `src/index.css` only. |
| "18 open dependabot alerts (npm) + rust quinn-proto" | Confirmed exactly: **18 npm + 1 rust = 19**, alert numbers #10–#39. |

**Three vulnerabilities Dependabot has not alerted on yet** but `npm audit` already sees (they will become alerts #40+):
- `smol-toml <=1.7.0` (GHSA-7w5x-hrqm-74c2, high) ← `knip@6.14.2`
- `baseline-browser-mapping <2.11.0` (GHSA-w5vr-8v7q-w6rv, moderate) ← `browserslist@4.28.2`
- Two **newer** brace-expansion advisories (GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895) needing `>=2.1.4` / `>=5.0.9` — strictly higher than the alerted floors of 2.1.2 / 5.0.7.

Plan for the floors from `npm audit`, not the floors in the alert list, or you will re-open alerts a week later.

---

## 1. Staged upgrade order

### The single biggest finding

**16 of the 18 npm alerts require no version bump at all.** Every fixed version already satisfies the range currently declared in `E:\2\web\package.json` or in the intermediate parent's own range. The lockfile is simply stale. A clean re-resolve clears them.

Only **2** alerts (#19, #20 — both `react-router`) need a major.

### Stage 0a — unblock npm resolution (BLOCKS EVERYTHING)

`npm install` in `E:\2\web` currently **fails outright** with ERESOLVE. Reproduced via `npm audit fix --dry-run`:

```
Found: echarts@6.1.0  (root declares ^6.1.0)
Could not resolve: peer echarts@"^5.0.1" from echarts-wordcloud@2.1.0
```

`echarts-wordcloud@2.1.0` is the **latest published version** (npm registry: 1.1.1 → 2.0.0 → 2.1.0-beta → 2.1.0, nothing since) and its peer is hard-pinned to `^5.0.1`. It is used at `E:\2\web\src\components\charts\EChart.tsx:26` (`import "echarts-wordcloud"`) for the single `type: "wordCloud"` series in `E:\2\web\src\components\charts\TagsWordCloud.tsx:35`.

This is why the lock has never been refreshed: nobody can run `npm install` successfully. The lock survives only because `npm ci` replays the tree without re-running peer resolution.

Fix, in preference order:

1. **Add an override** (unblocks immediately, 3 lines in `package.json`):
   ```json
   "overrides": { "echarts-wordcloud": { "echarts": "$echarts" } }
   ```
   `$echarts` resolves to the root's own `echarts` range, so this stays correct through future echarts bumps.
2. **Empirically verify the wordcloud still renders.** Production is *already* serving echarts 6.1.0 + wordcloud 2.1.0 — load `https://poli0981.github.io/free-steam-games-list/#/charts/tags` and confirm words appear. If it renders, the override is honest. If the canvas is blank, the plugin is silently broken under echarts 6 and has been for a while.
3. **If broken:** replace `TagsWordCloud` with an ECharts `treemap` (already registered in `EChart.tsx` — zero new deps) or vendor the ~600-line plugin. Do not downgrade to echarts 5; that fights the user's stated decision.

### Stage 0b — lockfile refresh (clears 16/18 npm alerts, zero source changes)

```
cd E:\2\web
rm package-lock.json          # or: npm update
npm install
npm audit
```

Why this must precede everything: every later stage rewrites the lock anyway, and starting from a stale tree means a duplicated `@types/react` 18/19 (the classic React-19 "two JSX namespaces" type explosion) and a duplicated `postcss` under Tailwind 4. Refresh once, from a green baseline.

### Stage 1 — Rust/Tauri lockfile bump (parallel with 0; independent tree)

`cargo update -p quinn-proto`. Details in §5.

### Stage 2 — react-router 6.30.4 → 7.18.3

Must precede React 19 because router 7 supports **both** React 18 and 19 (`peerDependencies: react >=18`), so doing it on React 18 isolates one variable. Doing it after React 19 means any breakage is ambiguous between two majors. Clears alerts #19 and #20 — the last two npm alerts.

Do **not** flip `HashRouter` → `BrowserRouter` in this stage. Keep `HashRouter` (still exported in v7) until the hosting track's Cloudflare Worker is live, then flip as a separate one-line commit. Two independent failure modes, two commits.

### Stage 3 — React 18.3.1 → 19.3.0

After Stage 2 so the router is already green. `react-dom@19.3.0` declares `peerDependencies: { react: "^19.3.0" }` — an exact-minor pin, so react and react-dom must be bumped in the same `npm install` or resolution fails. `@types/react` and `@types/react-dom` go to `19.3.0` in the same commit.

### Stage 4 — i18next 23.16.8 → 26.4.2 + react-i18next 15.7.4 → 17.0.13

`react-i18next@17.0.13` declares `peerDependencies: { i18next: ">= 26.2.0", typescript: "^5 || ^6 || ^7" }` — **i18next 26 forces react-i18next 17**; they cannot be split. Independent of React version (`react: ">= 16.8"`), so its position is a matter of blast-radius isolation only. Put it after React 19 so a `t()` typing regression isn't confused with a React typing regression.

### Stage 5 — Tailwind 3.4.19 → 4.3.3

Last of the JS stages. It touches every visual surface, so you want the component tree already stable to eyeball the diff against. It also **deletes** `postcss`, `autoprefixer`, `postcss-selector-parser`, `browserslist`, `baseline-browser-mapping` and `nanoid` from the dependency graph entirely — retiring 6 recurring alert sources permanently rather than patching them.

### Stage 6 — TypeScript

**`latest` is now 7.0.2 — the Go rewrite, not a point release.** Available: `5.9.3` (current) → `6.0.2` → `6.0.3` → `7.0.2`. Recommendation: go to **6.0.3** in this track, and treat **7.0.2 as its own separate PR after everything else is green**. Rationale: `react-i18next@17` accepts `^5 || ^6 || ^7`, so 6.0.3 satisfies every peer; TS 7 is a whole new compiler binary and its interaction with `tsc -b --noEmit` (used in `npm run build`, `npm run typecheck`) plus `knip@6` and `@vitejs/plugin-react@6` is unverified here. Do not stack a compiler rewrite on top of four framework majors.

### Stage 7 — Tauri + CSP

Must be last of the code stages: the CSP has to be written against the **final** bundle. Tailwind 4 emits CSS differently, React 19 changes dev-only injection, and the Cloudflare Worker origin doesn't exist until the hosting track lands.

### Stage 8 — CI gates + `.github/dependabot.yml`

Last, so the gates are switched on against a tree that already passes them.

### Alert → fix map (all 19, verified via `npm ls` / `gh api dependabot/alerts`)

| # | Package | Fixed at | Scope | Direct/Transitive | Actual parent chain | Resolution |
|---|---|---|---|---|---|---|
| 39 | react-router-dom | 6.30.6 | runtime | **Direct** (`^6.27.0`) | — | **Lock refresh** (6.30.6 satisfies `^6.27.0`). Also carried by Stage 2. |
| 20 | react-router | 7.18.0 | runtime | Transitive of react-router-dom | `react-router-dom@6.30.4` | **Requires v7 major.** No v6 patch exists. |
| 19 | react-router | 7.18.0 | runtime | Transitive of react-router-dom | `react-router-dom@6.30.4` | **Requires v7 major.** |
| 23 | postcss | 8.5.18 | runtime | **Direct** devDep (`^8.4.47`) | also under `tailwindcss`, `vite`, `autoprefixer` | **Lock refresh** → 8.5.28 |
| 29 | postcss | 8.5.23 | runtime | **Direct** devDep | same | **Lock refresh** → 8.5.28 |
| 28 | nanoid | 3.3.16 | runtime | Transitive | `postcss@8.5.15 → nanoid@3.3.12`; postcss's range is `^3.3.11` | **Lock refresh** → 3.3.18. No override. |
| 32 | nanoid | 3.3.18 | runtime | Transitive | same | **Lock refresh** |
| 34 | postcss-selector-parser | 6.1.3 | runtime | Transitive | `tailwindcss@3.4.19` (direct + via `postcss-nested@6.2.0`); range `^6.0.11` | **Lock refresh** → 6.1.3. **Deleted from tree by Stage 5.** |
| 38 | browserslist | 4.28.7 | dev | Transitive | `autoprefixer@10.5.0` **and** `workbox-build → @babel/core@7.29.0 / @babel/preset-env → core-js-compat` | **Lock refresh**. Also drags `baseline-browser-mapping` ≥2.11.0. **Deleted by Stage 5** (autoprefixer removed). |
| 10 | @babel/core | 7.29.6 | dev | Transitive | `vite-plugin-pwa@1.3.0 → workbox-build@7.4.1 → @babel/core@7.29.0`; range `^7.24.4` | **Lock refresh** |
| 15 | fast-uri | 3.1.3 | dev | Transitive | `vite-plugin-pwa → workbox-build@7.4.1 → ajv@8.20.0 → fast-uri@3.1.2` (also via `@apideck/better-ajv-errors@0.3.7`); ajv's range is `^3.0.1` | **Lock refresh** → 3.1.6 |
| 16 | fast-uri | 3.1.4 | dev | Transitive | same | **Lock refresh** |
| 26 | fast-uri | 3.1.5 | dev | Transitive | same | **Lock refresh** |
| 33 | fast-uri | 3.1.6 | dev | Transitive | same | **Lock refresh** |
| 35 | fast-uri | 3.1.6 | dev | Transitive | same | **Lock refresh** |
| 36 | fast-uri | 3.1.6 | dev | Transitive | same | **Lock refresh** |
| 14 | brace-expansion | 5.0.7 | dev | Transitive | `vite-plugin-pwa → workbox-build → glob@11.1.0 → minimatch@10.2.5 → brace-expansion@5.0.6` | **Lock refresh** → ≥5.0.9 (audit's real floor) |
| 30 | brace-expansion | 2.1.2 | dev | Transitive | `workbox-build → @trickfilm400/rollup-plugin-off-main-thread@3.0.0-pre1 → ejs@3.1.10 → jake@10.9.4 → filelist@1.0.6 → minimatch@5.1.9 → brace-expansion@2.1.0` | **Lock refresh** → ≥2.1.4 |
| 18 | quinn-proto | 0.11.15 | runtime (rust) | Transitive | `f2p-tracker → tauri-plugin-http@2.5.9 → reqwest@0.12.28 → quinn@0.11.9 → quinn-proto@0.11.14` | `cargo update -p quinn-proto` → 0.11.17 |

**No `overrides` entry is needed for any of them.** Every fixed version falls inside the parent's declared semver range — I checked each parent's range against the installed child. The only `overrides` entry the project needs is the `echarts-wordcloud` peer relaxation from Stage 0a.

Belt-and-braces fallback: if after `npm install` a deep node still resolves low (npm's dedupe occasionally leaves a nested copy), add narrowly:
```json
"overrides": {
  "echarts-wordcloud": { "echarts": "$echarts" },
  "fast-uri": "^3.1.6",
  "brace-expansion": "^5.0.9"
}
```
Note `brace-expansion` needs two different majors (2.x under `filelist`, 5.x under `glob`) — a flat `"brace-expansion": "^5.0.9"` override would **break** `minimatch@5.1.9`, which expects `^2`. If you must override, use the nested form: `"minimatch": { "brace-expansion": "^2.1.4" }`. This is exactly the trap that makes lock-refresh the better answer.

**Note on the whole dev-scope cluster:** `fast-uri` ×6, `brace-expansion` ×2, `@babel/core`, `browserslist` — **10 of 18 alerts** — all live under one root: `vite-plugin-pwa@1.3.0 → workbox-build@7.4.1`. `vite-plugin-pwa@1.3.0` **is** the latest and it peer-pins `workbox-build: ^7.4.1`, so you cannot escape workbox 7's dependency graph. These will keep re-appearing. This is the strongest argument for the dev-scope audit gate being **non-blocking** (§6).

---

## 2. react-router 6.30.4 → 7.18.3

### Are the alerts fixable in v6?

Fetched the advisories directly (`gh api advisories/…`):

- **GHSA-jjmj-jmhj-qwj2** ("Open redirect leading to XSS", alert #39) — two affected packages: `react-router-dom >=6.30.2, <=6.30.5` **patched in 6.30.6**, and `react-router >=7.9.6, <=7.12.0` patched in 7.13.0. → **A v6 patch exists.** `6.30.6` satisfies the current `^6.27.0`, so a lock refresh alone clears it.
- **GHSA-wrjc-x8rr-h8h6** ("Open redirect via backslash in `<Link>` and `useNavigate`", CVE-2025-68470 bypass, alert #20) — `react-router >=6.0.0, <7.18.0`, **first_patched_version: 7.18.0**. Single vulnerability entry, no v6 backport. → **v7 required.**
- **GHSA-337j-9hxr-rhxg** ("Arbitrary Constructor Injection via `deserializeErrors()` in SSR Hydration", alert #19) — `react-router >=6.4.0, <7.18.0`, **first_patched_version: 7.18.0**. → **v7 required.**

### Is the SSR-hydration one reachable here?

**No.** `deserializeErrors()` runs only on the hydration path: it consumes `window.__staticRouterHydrationData` / the `HydratedRouter` stream produced by a server render, reconstructing error objects by looking up a constructor name from serialized data. This app:
- renders exclusively client-side via `ReactDOM.createRoot(...).render(...)` at `E:\2\web\src\main.tsx:25`,
- uses the **declarative** `<HashRouter>` + `<Routes>` API, not a data router (`createBrowserRouter`/`RouterProvider`),
- has no `StaticRouterProvider`, no `HydratedRouter`, no `hydrateRoot`, no server anywhere (Cloudflare Static Assets serves a prebuilt `index.html`).

There is no code path that produces hydration data, so the sink is never fed. **Classify #19 as not-exploitable-in-this-configuration.** Dismiss it in the Dependabot UI as *"Vulnerable code is not actually used"* if you want the badge clean before Stage 2 lands, but fix it anyway via the v7 bump because it costs nothing extra.

**#20 (backslash open redirect) IS reachable.** `useNavigate` is called with a template-interpolated path at `E:\2\web\src\pages\Games.tsx:158`:
```ts
onRowOpen={(g) => navigate(`/games/${g.link.match(/\/app\/(\d+)/)?.[1] ?? ""}`)}
```
The interpolated segment is constrained to `\d+` by the regex, so *that* call is safe. But `E:\2\web\src\components\common\CommandPalette.tsx:97` does a bare `navigate(to)` from a command list, and the `to` values are app-internal constants — also safe today. The exposure is latent, not live. Still: v7 is the only fix, and it's the requested target.

### What actually changes in this app

The migration is **unusually small** — 12 files import `react-router-dom`, and every API used is v7-stable.

**`E:\2\web\src\App.tsx`** — `Routes`, `Route`, `Navigate` are all unchanged in v7. `<Route index element={<Navigate to="/charts/genres" replace />} />` (line 86) works identically. **Zero changes**, except the import specifier (below).

**`E:\2\web\src\main.tsx`** — `HashRouter` is still exported from v7. **Zero changes** for the version bump. The `HashRouter` → `BrowserRouter` swap is the hosting track's change, and in v7 it's still a one-line component swap.

**Import specifier — the one repo-wide edit.** In v7 the `react-router-dom` package is a thin re-export shim; the canonical package is `react-router`. Everything this app uses (`Routes`, `Route`, `Navigate`, `Link`, `NavLink`, `Outlet`, `HashRouter`, `BrowserRouter`, `useNavigate`, `useLocation`, `useParams`, `useSearchParams`) is exported from `react-router` in v7.

Recommended: install **both** `react-router@^7.18.3` and `react-router-dom@^7.18.3` and change all 11 source imports to `react-router`. Then in a follow-up, drop `react-router-dom` from `package.json` entirely. The 11 sites:

```
E:\2\web\src\App.tsx:1                                  Routes, Route, Navigate
E:\2\web\src\main.tsx:4                                 HashRouter
E:\2\web\src\components\auth\GpgQuickUnlock.tsx:3       Link
E:\2\web\src\components\common\CommandPalette.tsx:3     useNavigate
E:\2\web\src\components\common\ConsentGate.tsx:2        useLocation
E:\2\web\src\components\layout\Layout.tsx:1             Outlet, useLocation
E:\2\web\src\components\layout\Sidebar.tsx:1            NavLink, useLocation
E:\2\web\src\components\layout\Topbar.tsx:4             Link
E:\2\web\src\pages\Games.tsx:3                          useNavigate, useParams, useSearchParams
E:\2\web\src\pages\errors\ErrorCodeRoute.tsx:1          useParams
E:\2\web\src\pages\errors\ErrorPage.tsx:1               Link
```

Plus a 12th cosmetic site: `E:\2\web\src\pages\About.tsx:75` lists `"react-router-dom"` in the credits table — rename to `react-router`.

**Per-API verification against v7 semantics:**

- `useNavigate` (CommandPalette:97, Games.tsx:158/164) — signature unchanged. The v7.18.0 fix hardens the internal path parser against backslash-prefixed values; no call-site change.
- `useLocation` (ConsentGate, Layout, Sidebar) — unchanged. ConsentGate's `/error/*` bypass reads `location.pathname`/`location.hash`; under `HashRouter` in v7 `pathname` is still the post-`#` path. **Re-verify this specific bypass after the Hash→Browser flip**, not after the v7 bump.
- `useParams` (Games.tsx:19, ErrorCodeRoute:1) — unchanged; `useParams<{appid: string}>()` still returns `string | undefined` per key.
- `useSearchParams` (Games.tsx:20) — unchanged. v7 removed the `future.v7_startTransition` flags but the hook API is identical.
- `NavLink` (Sidebar.tsx:79) — the render-prop `className={({ isActive }) => …}` and the `end` prop are both unchanged. v7 adds `isPending`/`isTransitioning` to the render-prop arg; existing destructuring is forward-compatible.
- `Link` (3 sites) — unchanged.
- `Outlet` (Layout.tsx) — unchanged.
- `Navigate` (App.tsx:86) — unchanged.

**v7 breaking changes that do NOT apply here:** `json()`/`defer()` removal (not used), `RemixBrowser`/`unstable_` prefixes (not used), the framework-mode `routes.ts` file convention (opt-in only — declarative mode is fully supported in v7), Node version floor (build-only, CI is Node 24).

**Build config:** `E:\2\web\vite.config.ts:161` chunk group regex already includes both packages:
```
/[\\/]node_modules[\\/](react|react-dom|react-router-dom|react-router|scheduler)[\\/]/
```
No change needed. Once `react-router-dom` is dropped it becomes a dead alternation — harmless.

---

## 3. React 18.3.1 → 19.3.0

### ref-as-prop and `src/components/ui/*`

`React.forwardRef` is **deprecated in 19, not removed.** All 18 `forwardRef` call sites keep working:

```
button.tsx:35 · card.tsx:4,18,26,38,46,54 · dialog.tsx:11,26,63,75
input.tsx:6 · label.tsx:5 · popover.tsx:9 · separator.tsx:5
sheet.tsx:10,30 · textarea.tsx:6
```

There is **no forced rewrite** in this stage. Migrating them to plain `ref`-as-prop is a follow-up cleanup, not a blocker. If you do it, `npx codemod@latest react/19/remove-forward-ref` handles all 18 mechanically.

The one type-level item worth a codemod: **`React.ElementRef<T>` is deprecated in `@types/react@19`** in favour of `React.ComponentRef<T>`. 9 occurrences, all in shadcn wrappers:

```
dialog.tsx:12,27,64,76 · label.tsx:6 · popover.tsx:10 · separator.tsx:6 · sheet.tsx:11,31
```

Deprecated still compiles. `npx types-react-codemod@latest preset-19 ./src` renames them plus handles `useRef`, `JSX.Element`, and `ReactElement` prop-default changes.

### The codebase is exceptionally clean for this migration

I grepped for every removed-in-19 API. **All returned zero hits across `E:\2\web\src`:**

- `useRef()` with no argument (19's types now require an initial value) — **0**
- global `JSX.Element` / `JSX.*` namespace (moved to `React.JSX`) — **0**
- `defaultProps` on function components (removed) — **0**
- `propTypes` (removed) — **0**
- `ReactDOM.render` / `ReactDOM.hydrate` / `findDOMNode` (removed) — **0**
- string refs — **0**
- `React.FC` (its implicit-`children` change) — **0**

`main.tsx:25` already uses `ReactDOM.createRoot` from `react-dom/client` — the 19-native entry point. The realistic surface here is **`@types/react` 19's stricter `ReactNode`/`ReactElement` props defaulting to `unknown` instead of `any`**, which typically surfaces in generic wrappers — check `lib/utils`'s `cn()` and the `class-variance-authority` `ButtonProps` at `button.tsx:35`.

### Peer-dependency status under React 19 (all queried from the registry)

| Package | Installed | React-19 peer | Verdict |
|---|---|---|---|
| `@radix-ui/react-dialog` | 1.1.15 → 1.1.23 | `^16.8 \|\| ^17.0 \|\| ^18.0 \|\| ^19.0` | ✅ **Already 19-compatible at the installed version.** Bump anyway for ref-as-prop internals. |
| `@radix-ui/react-label` | 2.1.8 → 2.1.15 | same | ✅ |
| `@radix-ui/react-popover` | 1.1.15 → 1.1.23 | same | ✅ |
| `@radix-ui/react-separator` | 1.1.8 → 1.1.15 | same | ✅ |
| `@radix-ui/react-slot` | 1.2.4 → 1.3.3 | `react: ^16.8 \|\| … \|\| ^19.0` | ✅ |
| `cmdk` | ^1.0.0 → 1.1.1 | `^18 \|\| ^19` | ✅ |
| `sonner` | 1.7.4 | `^18.0.0 \|\| ^19.0.0` | ✅ **1.7.4 already supports 19.** `2.0.8` is optional (major: positioning/default changes). Stay on 1.7.4 in this stage. |
| `echarts-for-react` | 3.0.6 | `react: ^15.0.0 \|\| >=16.0.0` | ✅ Permissive — no ERESOLVE. |
| `react-i18next` | 15.7.4 | `react: >= 16.8` | ✅ |
| `@tanstack/react-query` | 5.100.9 → 5.102.8 | `^18 \|\| ^19` | ✅ |
| `@tanstack/react-virtual` | 3.13.24 → 3.14.11 | `^16.8 \|\| ^17 \|\| ^18 \|\| ^19` | ✅ |
| `zustand` | 4.5.7 | `react: >=16.8` | ✅ by range. See below. |
| `lucide-react` | 0.452.0 | `^16.5.1 \|\| … \|\| ^19.0.0` | ✅ **⚠️ Do not bump to 1.43.0 in this stage** — that's a 0.x→1.x major with renamed/removed icon exports. Separate PR. |
| `@vitejs/plugin-react` | 6.0.2 → 6.1.1 | — | ✅ Bump alongside; 6.x handles the React 19 JSX runtime and the compiler-friendly Fast Refresh. |

**Nothing blocks React 19.** No `--legacy-peer-deps`, no overrides.

**zustand bonus finding:** `zustand@5.0.15` peers `react >=18.0.0` and drops the `use-sync-external-store` shim for React's native `useSyncExternalStore`. I grepped all 4 stores (`auth.ts`, `consent.ts`, `filters.ts`, `gpg.ts`) — they use **only** `import { create } from "zustand"`, with **zero** uses of `shallow`, `useShallow`, the default export, or the removed 2-arg `useStore(store, equalityFn)`. So **zustand 4 → 5 is a literal zero-source-change bump here.** Take it in Stage 3; it removes a shim package from the runtime bundle.

### StrictMode double-invoke implications

**`main.tsx`'s i18n bootstrap — unaffected.**
```ts
initI18n().catch(...).finally(renderApp);   // main.tsx:62-64
```
This runs **once at module scope, outside React**. `renderApp` calls `createRoot(...).render(...)` once. StrictMode's double-invoke applies to component bodies, `useState`/`useMemo` initializers, effects, and (new in 19) ref callbacks — none of which is the i18n path. `initI18n` is also internally idempotent (`ensureBundle` short-circuits on `i18n.hasResourceBundle`). **No change needed.**

**`lib/lazy.ts`'s sessionStorage reload flag — a pre-existing race that React 19 makes marginally more visible.**

`lazyWithRetry` (`E:\2\web\src\lib\lazy.ts:53-71`) wraps `React.lazy`. React may invoke a lazy factory more than once (StrictMode double-render, Suspense retry, concurrent re-entry). If two invocations of the *same* factory both fail with a chunk error:

1. Invocation A: `getFlag()` false → `setFlag()` → `window.location.reload()` → returns a never-resolving `Promise` to hold the Suspense fallback.
2. Invocation B: `getFlag()` now **true** → `throw err` → propagates to `AppErrorBoundary`.

Result: the error UI flashes for the ~100 ms before the reload commits. Not introduced by 19, but React 19's StrictMode is more aggressive about re-running initializers, so the odds rise. **Concrete hardening** — memoize the decision per-factory in the closure, so the second invocation reuses the first's pending promise:

```ts
export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  let inflight: Promise<{ default: T }> | null = null;   // per-factory
  return lazy(() => (inflight ??= run()));
  // ...where run() holds the existing try/catch, and clears `inflight` on throw
}
```

**Cross-track finding for the Cloudflare migration.** `isChunkLoadError`'s regex (`lazy.ts:21`) matches:
`failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module`.

With Workers Static Assets and `not_found_handling: "single-page-application"`, a request for a **deleted hashed chunk** returns `index.html` with **HTTP 200**, not a 404. Chrome's error for that is `"Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of text/html."` — which the regex does **not** match. The retry-on-deploy mechanism would silently stop working on Cloudflare. Two fixes, take both:
1. Add `|expected a javascript(-or-wasm)? module script` to the regex.
2. In the Worker, `run_worker_first` on `/assets/*` and return a real 404 for unknown asset paths instead of letting SPA fallback swallow them.

---

## 4. Tailwind 3.4.19 → 4.3.3

### What happens to the config files

**`E:\2\web\postcss.config.js` — delete it.** Tailwind 4 does not ship a PostCSS plugin under the `tailwindcss` name any more. Two paths:

- **Recommended (Vite plugin):** `npm i -D @tailwindcss/vite@4.3.3`, whose peer is `vite: ^5.2.0 || ^6 || ^7 || ^8` — **Vite 8.2.2 satisfies it**. Add `tailwindcss()` to the `plugins` array in `E:\2\web\vite.config.ts` (before `VitePWA`). Then **remove `postcss`, `autoprefixer`, and `tailwindcss`'s PostCSS chain from devDependencies entirely.** Tailwind 4 does vendor prefixing and nesting internally via Lightning CSS.
- Alternative (stay on PostCSS): `@tailwindcss/postcss@4.3.3` as the sole plugin in `postcss.config.js`. Keeps `postcss` and `autoprefixer` in the tree — i.e. keeps 4 recurring alert sources alive. Don't.

**`E:\2\web\tailwind.config.ts` — delete it.** Tailwind 4 no longer auto-discovers a config file. (Escape hatch if you want a gradual move: `@config "../tailwind.config.ts";` at the top of `index.css`. Not recommended — the config here is 60 lines of pure token declarations that translate mechanically.)

**Content detection:** `content: ["./index.html", "./src/**/*.{ts,tsx}"]` is gone. Tailwind 4 auto-discovers by crawling from the CSS file's directory, respecting `.gitignore`. Since `index.css` lives at `src/index.css` and everything is under `src/`, auto-detection covers it — but `index.html` sits at `E:\2\web\index.html`, one level **up**. Add an explicit source line: `@source "../index.html";`.

### The CSS-first rewrite of `E:\2\web\src\index.css`

```css
@import "tailwindcss";
@import "tw-animate-css";                    /* replaces plugins:[tailwindcss-animate] */
@source "../index.html";

/* darkMode: ["class"]  →  this exact custom variant.
   index.html hardcodes <html lang="vi" class="dark">, so the selector must
   match the element itself AND its descendants. */
@custom-variant dark (&:where(.dark, .dark *));

/* The 17 raw HSL channel triples stay as PLAIN CSS, outside @theme, because
   they change per theme and @theme values are static tokens. Zero edits here —
   the whole :root / .dark block from lines 6-45 is copied verbatim. */
:root {
  --background: 0 0% 100%;
  /* ... all 17 vars unchanged ... */
  --radius: 0.5rem;
}
.dark {
  --background: 222.2 47% 6%;
  /* ... all 16 vars unchanged ... */
}

/* theme.extend.* → @theme. The shadcn DEFAULT/foreground nesting flattens. */
@theme {
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));

  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);

  --font-sans: Inter, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

/* container: {center, padding:"1rem", screens:{2xl:"1400px"}} — Tailwind 4
   REMOVED the container config entirely. Re-create it as a custom utility.
   The 2xl:1400px cap is redundant: the one consumer (Layout.tsx:41) already
   carries max-w-screen-2xl on the same element. */
@utility container {
  margin-inline: auto;
  padding-inline: 1rem;
}

@layer base {
  * { @apply border-border; }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
  ::-webkit-scrollbar { @apply h-2 w-2; }
  ::-webkit-scrollbar-track { @apply bg-transparent; }
  ::-webkit-scrollbar-thumb { @apply rounded-full bg-muted hover:bg-muted-foreground/30; }
}

@layer utilities {
  .scrollbar-thin { scrollbar-width: thin; }
}
```

### `@apply` — the details that matter

All 5 `@apply` sites (`index.css` lines 48, 51, 55, 58, 61) live in the **same file that imports Tailwind**, so they need **no `@reference` directive**. That's the v4 gotcha that bites people, and it does not bite here.

`E:\2\web\src\components\common\command-palette.css` has **no `@apply`, no `@tailwind`, no `@layer`** — verified line by line. It is 100% hand-written CSS reading `hsl(var(--border))` etc. directly. **It needs zero changes** and would not need `@reference` even if imported separately.

**Opacity modifiers need verification.** In v3, `hsl(var(--x))` + `/30` required an `<alpha-value>` placeholder. In v4, `bg-muted-foreground/30` (index.css:61) and `bg-primary/15` (`Sidebar.tsx:87`) compile to `color-mix(in oklab, hsl(var(--x)) 30%, transparent)`, which works with a plain `hsl(var(--x))` token. **Visually diff those two specific classes** after migration — they're the only alpha modifiers in the codebase.

**Default border color changed** from `gray-200` to `currentColor` in v4. The `* { @apply border-border }` global reset already overrides it everywhere, so there is **no visual regression** here. (This is the single most common Tailwind 4 visual break, and this codebase happens to be immune.)

### Renamed utilities

Run `npx @tailwindcss/upgrade` — it does every rename mechanically. The ones present in this codebase:

| v3 | v4 | Present? |
|---|---|---|
| `outline-none` | `outline-hidden` | Yes — 6 sites |
| `shadow-sm` | `shadow-xs` | Yes — 16 |
| `shadow` | `shadow-sm` | Yes — 13 |
| `rounded-sm` | `rounded-xs` | Yes — 2 |
| `rounded` (bare) | `rounded-sm` | Yes — my raw grep says 121, but `\brounded\b` also matches inside `rounded-md`/`rounded-full`, so the true bare-`rounded` count is lower. **Trust the codemod, not my number.** |
| `ring` (bare, 3px → 1px) | `ring-3` to preserve | Yes — 17 raw hits (again inflated by `ring-1`/`ring-2`/`ring-offset`) |
| `max-w-screen-2xl` | deprecated → `max-w-[1536px]` | Yes — `Layout.tsx:41` |

### Companion bumps required in the same commit

- **`tailwind-merge` 2.6.1 → 3.6.0 is mandatory.** v2's conflict tables don't know v4's renamed scales; `cn()` will silently mis-merge classes. This is not optional.
- **`tailwindcss-animate@1.0.7` → `tw-animate-css@1.4.0`.** `tailwindcss-animate` is a v3 JS plugin (peer `tailwindcss >=3.0.0`, unmaintained at 1.0.7). Tailwind 4 *can* load it via `@plugin "tailwindcss-animate";`, but `tw-animate-css` is the v4-native successor with identical class names. The classes actually used are all covered: `animate-in` (5), `animate-out` (5), `fade-in-0` (3), `fade-in` (2), `slide-in-from-{right,top,left,bottom}`, `slide-out-to-{right,left}`, `duration-200`.
- Remove `autoprefixer` and `postcss` from `devDependencies`.

**Net alert impact of Stage 5:** permanently removes `postcss`, `nanoid`, `autoprefixer`, `browserslist`, `baseline-browser-mapping`, and `postcss-selector-parser` from the graph — 6 alert sources retired, not patched.

---

## 5. Rust / Tauri

### quinn-proto (alert #18)

**Correction:** `E:\2\web\src-tauri\Cargo.lock` **exists and is git-tracked**. Dependabot's own alert metadata confirms `manifest_path: "web/src-tauri/Cargo.lock"`.

Advisory **GHSA-4w2j-m93h-cj5j** — *"Quinn: Remote memory exhaustion in quinn-proto from unbounded out-of-order stream reassembly"*, high, `>= 0.1.0, < 0.11.15`, **first patched 0.11.15**. Registry max is now **0.11.17**.

Exact chain, read out of the lockfile:
```
f2p-tracker
 └─ tauri-plugin-http 2.5.9
     └─ reqwest 0.12.28        ← activates the `quinn` optional dep
         └─ quinn 0.11.9
             └─ quinn-proto 0.11.14   ← VULNERABLE
```

Note the lock contains **two** reqwest majors: `tauri-plugin-updater 2.10.1` uses **reqwest 0.13.3**, whose dependency list contains **no `quinn`** at all. So the QUIC stack enters the binary solely through `tauri-plugin-http`.

**Fix — lockfile only, no `Cargo.toml` change:**
```
cd E:\2\web\src-tauri
cargo update -p quinn-proto
```
`quinn 0.11.9` requires `quinn-proto ^0.11`, so 0.11.15–0.11.17 is semver-compatible and resolves without touching `reqwest` or `tauri-plugin-http`. Commit the `Cargo.lock`.

If you want to be conservative: `cargo update -p quinn-proto --precise 0.11.15`.

Worth noting for the CI section: **nothing in this repo's 23 workflows runs `cargo audit`.** Alert #18 exists only because Dependabot scans the committed lockfile. A `cargo update` today fixes it; without a gate it will silently rot again.

### Tauri 2 + plugin bumps

| Component | Locked/installed | Latest | Action |
|---|---|---|---|
| `tauri` (crate) | 2.11.1 | **2.11.5** | `cargo update -p tauri` |
| `tauri-plugin-http` (crate) | 2.5.9 | latest 2.x | `cargo update` |
| `tauri-plugin-updater` (crate) | 2.10.1 | latest 2.x | `cargo update` |
| `tauri-plugin-shell`, `-single-instance` | — | latest 2.x | `cargo update` |
| `@tauri-apps/api` (npm) | 2.11.0 | **2.11.1** | bump |
| `@tauri-apps/cli` (npm) | 2.11.1 | **2.11.4** | bump |
| `@tauri-apps/plugin-http` (npm) | 2.5.9 | **2.6.0** | bump |
| `@tauri-apps/plugin-shell` (npm) | 2.3.5 | **2.3.6** | bump |

**The JS `@tauri-apps/*` packages and their Rust `tauri-plugin-*` counterparts must move in the same commit.** A JS plugin newer than its Rust half fails ACL/command resolution at runtime with an opaque "command not found" — a class of bug that only shows up in a packaged build, never in `tauri dev`.

**Stale MSRV declaration:** `E:\2\web\src-tauri\Cargo.toml:9` says `rust-version = "1.77"`. Tauri 2.11's actual MSRV is 1.82+. The declaration is a lie that only affects `cargo` diagnostics, but fix it to `1.82` (or higher) while you're in the file.

### Updater re-verification checklist

`tauri.conf.json` sets `"createUpdaterArtifacts": true`, endpoint `https://github.com/poli0981/free-steam-games-list/releases/latest/download/latest.json`, minisign pubkey `9F39774AE5453C53`. After the bump:
1. Confirm `capabilities/updater.json` still resolves — it's platform-gated to `["windows","linux","macOS"]`, which is correct given the Cargo.toml `cfg(not(android|ios))` gate.
2. Confirm `latest.json`'s schema is unchanged across 2.11.1→2.11.5 (it has been stable, but the endpoint is a hard dependency).
3. **The CSP you're about to add must not block the updater.** The updater's HTTP fetch happens in **Rust** (`reqwest`), not the webview, so `connect-src` does **not** gate it. Verify empirically anyway — this is the #1 way a new Tauri CSP breaks an app.

### Concrete CSP for `E:\2\web\src-tauri\tauri.conf.json`

Origins derived from the actual code and the actual dataset:

- **`https://*.steamstatic.com`** — I grepped all 5 shards: **1,927 `header_image` URLs on `shared.akamai.steamstatic.com` and 1,496 on `shared.fastly.steamstatic.com`.** A CSP listing only `shared.akamai.steamstatic.com` would break **~44% of all thumbnails.** *(Same bug already exists in the SW: `vite.config.ts:95` `runtimeCaching` only matches `shared.akamai`, so nearly half the images are never precached, and `index.html:12` only preconnects to akamai. Hand this to the caching track.)*
- **`https://raw.githubusercontent.com`** — `lib/fetcher.ts:15` `RAW_BASE`.
- **`https://api.github.com`** + **`https://github.com`** — `lib/git-data.ts` writes and `lib/oauth-device.ts` (device flow hits `github.com/login/device/code` and `/login/oauth/access_token`).
- **`https://avatars.githubusercontent.com`** — SW `gh-avatars` cache; user avatar in the topbar.
- **`https://free-steam-games.win`** — the new Worker origin (data + Worker-transformed images).
- **`images.weserv.nl` is deliberately absent from the *desktop* CSP.** `preferWebp()` at `E:\2\web\src\lib\image.ts` short-circuits with `if (!url || isTauri()) return url;` — the Tauri build **never** calls weserv. Adding it would be dead permission.
- **openpgp needs nothing special.** `find node_modules/openpgp -name "*.wasm"` returns **empty** — the main entry (`openpgp.min.mjs`) is pure JS; only the optional `lightweight/` build uses WASM and `lib/gpg.ts:22` does a bare `await import("openpgp")` which resolves to the main entry. **No `wasm-unsafe-eval`.** It also spawns no Worker.
- **ECharts needs nothing special.** `EChart.tsx:18` imports **only** `CanvasRenderer` (no `SVGRenderer`), so no `<style>` injection and no `eval`. `echarts-wordcloud` is canvas + `Math.random`. **No `unsafe-eval`.**
- **The JSONL Worker** — `worker-pool.ts:19` does `new Worker(new URL("../workers/jsonl-parser.ts", import.meta.url), { type: "module" })`, which Vite emits as a **same-origin `.js` file** (not a blob, because `vite.config.ts` sets `worker.format: "es"`). `worker-src 'self'` suffices; no `blob:`.

```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https://*.steamstatic.com https://avatars.githubusercontent.com https://free-steam-games.win; connect-src 'self' ipc: http://ipc.localhost https://raw.githubusercontent.com https://api.github.com https://github.com https://free-steam-games.win; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'"
}
```

**Directive-by-directive:**

- `default-src 'self'` — deny-by-default fallback. Everything not explicitly listed below falls back to same-origin only. This is what makes the whole policy meaningful.
- `script-src 'self'` — only bundled chunks execute. No inline scripts, no `eval`. Tauri **auto-augments** this at build time with its own IPC bootstrap nonce, so you do not add `'unsafe-inline'` for Tauri's sake. Verified safe because nothing here (React 19, ECharts canvas, openpgp main build) needs `eval` or `new Function`.
- `style-src 'self' 'unsafe-inline'` — **`'unsafe-inline'` is unavoidable and I'm not going to pretend otherwise.** Radix's `react-remove-scroll` injects a `<style>` element for scroll-locking; `cmdk` injects its own; `sonner` is configured with a runtime style object at `main.tsx:38-44`. A nonce can't cover runtime-injected stylesheets in a static bundle. The XSS risk of inline *styles* (as opposed to scripts) is CSS-exfiltration-tier, and `script-src 'self'` still holds the line.
- `style-src-attr 'unsafe-inline'` — **explicitly stated because `style-src` does NOT cover `style=""` attributes** in CSP3. React sets inline style attributes constantly (every `<div style={{…}}>`). Omitting this is the most common way a "correct-looking" CSP silently breaks a React app's layout.
- `font-src 'self' data:` — the theme declares `Inter` / `JetBrains Mono` but no `@font-face` or Google Fonts link exists, so today this resolves to system fonts. `data:` covers any future inlined `woff2` (the Workbox `globPatterns` at `vite.config.ts:64` already precaches `woff2`).
- `img-src 'self' data: blob: https://*.steamstatic.com …` — `data:` for the inline SVG favicon/icons; `blob:` for any canvas `toDataURL`/export path. The wildcard on steamstatic is load-bearing (see the akamai/fastly split above).
- `connect-src` — `fetch`/XHR/WebSocket allowlist. **`ipc:` and `http://ipc.localhost` are mandatory on Tauri 2**: the moment you set a non-null CSP, the webview→Rust IPC channel becomes subject to it, and on Windows the IPC runs over `http://ipc.localhost`. Omit these and **every** `invoke()` fails silently — including `shell:open` and the OAuth device flow. This is the single most likely thing to go wrong.
- `worker-src 'self'` — the module worker. Not covered by `script-src` in CSP3.
- `manifest-src 'self'` — the PWA manifest that VitePWA emits.
- `object-src 'none'` / `frame-src 'none'` / `frame-ancestors 'none'` — no plugins, no iframes, no embedding. `frame-ancestors` is inert in a Tauri webview but costs nothing and carries over verbatim to the web policy.
- `base-uri 'self'` — blocks `<base href>` injection, which would otherwise re-point every relative asset URL. Cheap, high value.
- `form-action 'none'` — there are no `<form>` submits (everything is `fetch`), so this closes an exfil channel outright.
- **Deliberately omitted:** `upgrade-insecure-requests` — it would rewrite Tauri's own `http://ipc.localhost` and `http://tauri.localhost` to `https://` and break the app. Include it in the **web** policy, never the Tauri one.

**Web (Cloudflare Worker response header) variant** — same policy, minus the Tauri IPC bits, plus weserv while it's still in the loop, plus the upgrade directive:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https://*.steamstatic.com https://images.weserv.nl https://avatars.githubusercontent.com; connect-src 'self' https://raw.githubusercontent.com https://api.github.com https://github.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'; upgrade-insecure-requests
```

Ship it `Content-Security-Policy-Report-Only` for one deploy cycle first — you cannot enumerate Radix/cmdk/sonner's runtime injections by reading source alone.

**Also fix while in `tauri.conf.json`:** `bundle.longDescription` says *"Browses 1,200+ free-to-play games"* — actual count is 3,424. Same stale number as `index.html` and README.

---

## 6. Python

### Consolidate the version — with a mechanism, not a convention

Current spread across 15 workflows: **3.11** ×1 (`mark-dead-games`), **3.12** ×7 (`anti-cheat-list`, `bot-ingest`, `check-dead-links`, `ingest-from-issue`, `snapshot-daily`, `top-offline`, `top-online`), **3.14** ×7 (`codeql`, `ingest-new`, `purge-unhealthy`, `refetch-all`, `update-daily`, `update-json`, `update-reviews`).

**Standardize on 3.12**, because: (a) it's already the plurality-with-snapshot, (b) `docs/dev_env.md` and `AUTHORS.md` already *claim* 3.12 — picking it makes the docs true for free instead of requiring a doc edit, (c) the pipeline is pure I/O-bound `requests`, so 3.14's JIT/free-threading buys literally nothing, while 3.14 is the version most likely to lack a wheel for any future dep.

**Don't enforce it by editing 15 literals — that's how it drifted in the first place.** Commit `E:\2\.python-version` containing `3.12`, and change every workflow to:
```yaml
- uses: actions/setup-python@v6
  with:
    python-version-file: '.python-version'
    cache: 'pip'
    cache-dependency-path: 'requirements.txt'
```
`actions/setup-python` supports `python-version-file` natively. One file, one value, impossible to drift. Bonus: `pyenv` and `uv` read the same file, so local dev converges too.

### Make workflows actually install `requirements.txt`

`requirements.txt` pins:
```
requests>=2.32.5,<3
urllib3>=2.6.3,<3
```

**12 of 13 install sites ignore it.** They run `pip install --quiet requests`:

```
bash/anti_cheat.sh:3   bash/dead_links.sh:3   bash/ingest.sh:3
bash/json.sh:3         bash/offline.sh:3      bash/online.sh:3
bash/purge.sh:3        bash/refetch_all.sh:5  bash/reviews.sh:3
bash/snapshot.sh:3
.github/workflows/bot-ingest.yml:49
.github/workflows/ingest-from-issue.yml:30
```

The **only** correct one is `.github/workflows/mark-dead-games.yml:38` (`pip install -r requirements.txt`) — which is also the only scheduled workflow currently passing. Coincidence (it uses `GITHUB_TOKEN` not the expired `GH_TOKEN`), but a telling one.

Consequence: the `urllib3>=2.6.3` floor — which exists deliberately — is **never enforced anywhere in CI**, and `requests` floats to whatever's newest at run time. Reproducibility is zero.

**Fix:** replace `pip install --quiet requests` with `pip install --quiet -r requirements.txt` in all 10 `bash/*.sh` and the 2 inline workflow steps. Since `bash/*.sh` are the CI wrappers, editing the scripts fixes most workflows without touching YAML.

Consider going further: pin exactly (`requests==2.32.5`) and let Dependabot's `pip` ecosystem propose bumps. With `>=`/`<3` ranges, Dependabot has nothing to do and you get silent drift. Given this is a data pipeline that commits to `main` unattended, exact pins + Dependabot PRs is the right trade.

### CI gates — yes, but scoped so they can't stop the dataset

`requirements-dev.txt` already declares `pip-audit>=2.6` and **nothing runs it.** Close that.

Create **one** `.github/workflows/security-audit.yml`:

```yaml
name: Security audit
on:
  schedule: [{ cron: '0 6 * * 1' }]        # weekly, Monday 06:00 UTC
  pull_request:
    paths: ['requirements*.txt', 'web/package.json', 'web/package-lock.json',
            'web/src-tauri/Cargo.toml', 'web/src-tauri/Cargo.lock']
  workflow_dispatch:
permissions: { contents: read }
concurrency: { group: security-audit, cancel-in-progress: true }
```

Three jobs:

1. **pip-audit** — `pip install -r requirements-dev.txt && pip-audit -r requirements.txt --strict`. **Blocking.** The runtime surface is 2 packages; a real CVE there matters and the fix is trivial.

2. **npm audit, split into two steps:**
   - `cd web && npm audit --audit-level=high --omit=dev` — **blocking.** Gates what actually ships to users.
   - `cd web && npm audit --audit-level=high || true` (full tree, incl. dev) — **non-blocking, annotate only.**

   The split is essential: **10 of the current 18 alerts are dev-scope, and all 10 sit under one unavoidable root** (`vite-plugin-pwa@1.3.0 → workbox-build@7.4.1`, whose peer pin you cannot escape because 1.3.0 *is* latest). A blocking dev-scope gate would red-X every PR on build-tool churn nobody can fix. Gate on what ships; annotate the rest.

3. **cargo audit** — `rustsec/audit-check@v2` (or `cargo install cargo-audit && cargo audit`) against `web/src-tauri/Cargo.lock`. **Blocking.** This is what would have caught quinn-proto without waiting on Dependabot, and today literally nothing in 23 workflows looks at the Rust tree.

**Do NOT bolt these onto the 15 data-writing cron workflows.** Those commit to `data/` unattended; failing them on an unrelated CVE in `requests` would silently freeze the dataset — a worse outcome than the CVE.

**Separately, in the 3 Node workflows:** `deploy-pages.yml:37`, `release-android.yml:74`, `release-desktop.yml:65` all run `npm ci || npm install`. **Drop the `|| npm install`.** That fallback is precisely the mechanism that let the lock rot: when `npm ci` fails on manifest/lock disagreement, `npm install` silently rewrites the tree instead of failing loudly. (Requires Stage 0a first — with the echarts peer conflict unresolved, `npm ci` is the *only* thing that works, which is a good illustration of how bad the current state is.) `deploy-pages.yml` gets deleted by the hosting track anyway; fix the other two.

---

## 7. `js/missing-origin-check` at `web/src/workers/jsonl-parser.ts:13`

Alert #2, `js/missing-origin-check`, security-severity **medium**, message *"Postmessage handler has no origin check."*

### Verdict: false positive as a security finding; true positive as a robustness finding. Fix the robustness half, dismiss the security half.

**Why the security claim doesn't hold:**

1. The rule models `window.addEventListener("message", …)` — **cross-document** messaging, where `event.origin` identifies which document sent the message and an attacker can `postMessage` from any frame. This is a **dedicated module Web Worker**. Messages reach `self.onmessage` only from the `Worker` object that created it, or from a `MessagePort` explicitly transferred in. Neither is a cross-origin channel.

2. **`MessageEvent.origin` is the empty string `""` for dedicated-worker messages.** An origin check here isn't merely redundant — it is **unimplementable**. Any `if (e.origin !== X) return;` you write would either always pass or always fail. The query has no valid remediation on this file.

3. There is exactly **one** creator, and it's same-origin. `E:\2\web\src\lib\worker-pool.ts:19-21`:
   ```ts
   worker = new Worker(
     new URL("../workers/jsonl-parser.ts", import.meta.url),
     { type: "module" },
   );
   ```
   I grepped the whole tree: this is the **only** `new Worker` site, there is no `SharedWorker`, no `MessagePort` handed to any third party, and no `postMessage(…, "*")` anywhere.

**Why it's a real robustness bug anyway:**

Line 14 destructures with no validation:
```ts
const { id, text } = e.data;
```
`parseJsonl(text)` then receives whatever arrives. A `text` of `undefined` throws inside `parseJsonl` (caught, so it degrades to an error reply), but a **non-number `id`** poisons the `pending` Map correlation in `worker-pool.ts` — the promise for the real request never settles, and `parseShard` hangs forever with no timeout. That's a genuine liveness bug reachable from any future code that ever posts to this worker.

The gap is **symmetric and worse on the main thread**: `worker-pool.ts:23-31` trusts `e.data.records` and casts straight to `GameRecord[]` with zero validation. CodeQL didn't flag that side, but it's the one that feeds unvalidated objects into the React tree and IndexedDB.

### Exact fix

`E:\2\web\src\workers\jsonl-parser.ts`:
```ts
self.onmessage = (e: MessageEvent<unknown>) => {
  const d = e.data as Partial<InMessage> | null;
  // Dedicated-worker messages carry no usable `origin` (always ""), so shape
  // validation is the only meaningful guard. Silently drop malformed input:
  // replying would risk resolving an unrelated pending request.
  if (
    typeof d !== "object" || d === null ||
    typeof d.id !== "number" || !Number.isFinite(d.id) ||
    typeof d.text !== "string"
  ) {
    return;
  }
  const { id, text } = d as InMessage;
  try {
    (self as unknown as Worker).postMessage({ id, records: parseJsonl(text) });
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
```

And the symmetric guard in `worker-pool.ts:23`:
```ts
const { id, records, error } = e.data ?? {};
if (typeof id !== "number") return;
```

### Dismissal

A shape check may not clear `js/missing-origin-check`, because the query specifically looks for a guard on `event.origin` or `event.source`. So **fix the code, then dismiss the alert** with a justification that survives review:

```
gh api -X PATCH repos/poli0981/free-steam-games-list/code-scanning/alerts/2 \
  -f state=dismissed \
  -f dismissed_reason='wont_fix' \
  -f dismissed_comment='Dedicated module Web Worker, not a cross-document message handler. MessageEvent.origin is always "" for dedicated-worker messages, so an origin check is unimplementable. The worker has exactly one same-origin creator (web/src/lib/worker-pool.ts:19) and no MessagePort is transferred to any third party. Message-shape validation added at jsonl-parser.ts:13 to close the malformed-payload path CodeQL was pointing at.'
```

Do **not** use `// lgtm[…]` inline suppression — GitHub's default CodeQL setup no longer honours it.

---

## 8. `.github/dependabot.yml`

**Important precondition:** an in-repo `.github/dependabot.yml` **overrides** the repo-settings UI configuration entirely. The moment you commit this, the settings-UI behaviour stops and only this file applies. It will also **supersede the existing open PR #111** (`dependabot npm_and_yarn group`) — the group name changes, so Dependabot closes and re-opens. Expect that; don't treat it as a regression.

```yaml
# Overrides the repo-settings Dependabot config. Grouping is deliberate: an
# ungrouped setup opens one PR per transitive bump, and 10 of this repo's 18
# npm alerts sit under a single unavoidable root (vite-plugin-pwa ->
# workbox-build), which produced a PR storm.
version: 2

updates:
  # ── npm (web app + Tauri frontend) ──────────────────────────────────────
  - package-ecosystem: "npm"
    directory: "/web"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
      timezone: "Etc/UTC"
    open-pull-requests-limit: 5
    labels: ["dependencies", "npm"]
    commit-message:
      prefix: "chore(deps)"
      prefix-development: "chore(deps-dev)"
      include: "scope"

    groups:
      # Collapse ALL security bumps into one PR. Without applies-to, the 18
      # current alerts would arrive as ~10 separate PRs.
      npm-security:
        applies-to: security-updates
        patterns: ["*"]

      # React + router move together or not at all: react-dom pins
      # `react: ^19.3.0` exactly, and react-router 7 peers on react >=18.
      react:
        applies-to: version-updates
        patterns:
          - "react"
          - "react-dom"
          - "react-router"
          - "react-router-dom"
          - "@types/react"
          - "@types/react-dom"

      # Radix ships ~20 packages that version in lockstep.
      radix-ui:
        applies-to: version-updates
        patterns: ["@radix-ui/*"]

      # Tauri JS packages must stay in step with the Rust crates below.
      tauri-js:
        applies-to: version-updates
        patterns: ["@tauri-apps/*"]

      # i18next 26 forces react-i18next 17 (peer: i18next >= 26.2.0).
      i18n:
        applies-to: version-updates
        patterns: ["i18next", "i18next-*", "react-i18next"]

      # Tailwind 4 + tailwind-merge 3 are a mandatory pair (v2's conflict
      # tables don't know v4's renamed scales).
      tailwind:
        applies-to: version-updates
        patterns:
          - "tailwindcss"
          - "@tailwindcss/*"
          - "tailwind-merge"
          - "tw-animate-css"
          - "tailwindcss-animate"
          - "autoprefixer"
          - "postcss"

      # Everything else dev-scope in one weekly PR.
      build-tooling:
        applies-to: version-updates
        dependency-type: "development"
        patterns: ["*"]
        exclude-patterns:
          - "@types/react"
          - "@types/react-dom"
          - "@tauri-apps/*"
          - "tailwindcss"
          - "@tailwindcss/*"
          - "postcss"
          - "autoprefixer"

      # Remaining runtime deps, patch+minor only. Majors arrive as
      # individual PRs so they get individual review.
      runtime-minor:
        applies-to: version-updates
        dependency-type: "production"
        update-types: ["minor", "patch"]
        patterns: ["*"]

    ignore:
      # 0.x -> 1.x is a breaking icon-export rename; do it deliberately.
      - dependency-name: "lucide-react"
        update-types: ["version-update:semver-major"]
      # TypeScript 7 is the Go compiler rewrite, not a point release.
      # Remove this once the TS 7 migration PR has landed.
      - dependency-name: "typescript"
        update-types: ["version-update:semver-major"]

  # ── cargo (Tauri desktop/Android shell) ────────────────────────────────
  # Nothing in CI audits this tree today; alert #18 (quinn-proto) was found
  # only because Cargo.lock is committed.
  - package-ecosystem: "cargo"
    directory: "/web/src-tauri"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
      timezone: "Etc/UTC"
    open-pull-requests-limit: 3
    labels: ["dependencies", "rust"]
    commit-message:
      prefix: "chore(deps)"
    groups:
      cargo-security:
        applies-to: security-updates
        patterns: ["*"]
      tauri:
        applies-to: version-updates
        patterns: ["tauri", "tauri-*", "wry", "tao"]
      cargo-minor:
        applies-to: version-updates
        update-types: ["minor", "patch"]
        patterns: ["*"]

  # ── pip (data pipeline) ────────────────────────────────────────────────
  # Only useful once requirements.txt pins exactly (==) rather than >=/<3 —
  # with open ranges Dependabot has nothing to propose. See §6.
  - package-ecosystem: "pip"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
      timezone: "Etc/UTC"
    open-pull-requests-limit: 3
    labels: ["dependencies", "python"]
    commit-message:
      prefix: "chore(deps)"
    groups:
      python:
        patterns: ["*"]

  # ── github-actions ─────────────────────────────────────────────────────
  # Directly targets the checkout v4/v5/v6 and setup-python v5/v6 drift
  # across 23 workflows. One grouped PR normalizes the lot.
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
      timezone: "Etc/UTC"
    open-pull-requests-limit: 2
    labels: ["dependencies", "ci"]
    commit-message:
      prefix: "ci(deps)"
    groups:
      actions:
        patterns: ["*"]
```

**Notes on the design:**

- `applies-to: security-updates` with `patterns: ["*"]` is the single highest-value line in the file. Grouped security updates collapse the current 18 alerts into roughly **2 PRs** (one npm, one cargo) instead of 18.
- The `github-actions` block is the direct remedy for the version drift described in the brief: `actions/checkout` at v4 (×8) / v5 (×3) / v6 (×7), `actions/setup-python` at v5 (×7) / v6 (×8), `actions/github-script` at v7 / v8. One grouped PR normalizes all of it.
- **`tauri-apps/tauri-action@v0` is not fixed by this file.** A floating major-zero tag means Dependabot sees no upgrade to propose. Either pin it to a concrete release (`tauri-apps/tauri-action@v0.5.x`) or, better, SHA-pin every third-party action and let Dependabot bump the SHAs — it does that natively and it's the only real supply-chain protection here. Currently **all third-party actions are tag-pinned, not SHA-pinned**, which means a compromised tag re-point executes in a workflow that has `contents: write` and `secrets: inherit`.
- The `pip` block is close to a no-op until `requirements.txt` moves from `>=`/`<3` ranges to exact `==` pins. Ship §6's pin change in the same PR or this block does nothing.
- `directory: "/web"` for npm and `directory: "/web/src-tauri"` for cargo — the repo root has no `package.json` and no `Cargo.toml`, so pointing either at `/` finds nothing.

---

## Could not verify / open questions

1. **Does `echarts-wordcloud@2.1.0` actually still render under `echarts@6.1.0`?** The lockfile has shipped this combination to production for some time. I could not install to test (read-only). **Load `https://poli0981.github.io/free-steam-games-list/#/charts/tags` and look.** If blank, replace the chart (§1 Stage 0a option 3) — everything downstream depends on `npm install` resolving.
2. **Exact declared semver ranges of two deep parents** — `minimatch@10.2.5 → brace-expansion` and `minimatch@5.1.9 → brace-expansion`. I inferred `^5` and `^2` from the resolved versions (5.0.6, 2.1.0) but did not read the parents' own `package.json`. If a lock refresh leaves either below the audit floor, use the **nested** override form in §1 — a flat `brace-expansion` override will break `minimatch@5`.
3. **TypeScript 7.0.2 compatibility** with `tsc -b --noEmit`, `knip@6`, `@vitejs/plugin-react@6`, and the `allowImportingTsExtensions` + `moduleResolution: "Bundler"` combination in `E:\2\web\tsconfig.json`. Unverified — hence the recommendation to land 6.0.3 first.
4. **Whether Tauri 2.11.x auto-augments `style-src`** with its own nonce the way it does `script-src`. If it does not, the `'unsafe-inline'` in `style-src` is doubly required; if it does, it's still required for Radix/cmdk/sonner. Either way the string above is correct — but ship it as `Content-Security-Policy-Report-Only` on web first to enumerate what actually gets blocked.
5. **Whether `run_worker_first: ["/api/*"]` interacts with the module Worker's `/assets/*.js` path** under Workers Static Assets. Relevant to the `isChunkLoadError` MIME-type finding in §3; belongs to the hosting track but the two changes must land together.
6. **`shared.fastly.steamstatic.com` in the SW config** — I verified 1,496 dataset rows use it and that `vite.config.ts:95`'s regex excludes it, but I did not measure the live cache-hit impact. Hand to the caching track.