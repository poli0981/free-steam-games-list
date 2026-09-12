# SvelteKit migration — the routing question, settled

## Why this note exists

The v4.0.0 plan named one blocking risk and said to spike it before porting any
page:

> SvelteKit has no `HashRouter`, and today `web/src/main.tsx` uses one under
> `isTauri()` precisely because the Tauri webview has no server fallback.

Everything downstream depends on the answer — whether the Tauri build can use
real paths, whether a hash shim is needed, and whether `/games/[appid]` can be
a route at all in the packaged apps.

## The answer: Tauri 2 already falls back to index.html

`tauri::manager::AppManager::get_asset()` resolves a request in four steps.
From `tauri-2.11.1/src/manager/mod.rs:405-432` — and 2.11.1 is the exact
version pinned in `web/src-tauri/Cargo.lock`:

```rust
let asset_response = assets
  .get(&asset_path)
  .or_else(|| {            // 1. exact match
    let fallback = format!("{path}.html").into();      // 2. <path>.html
    ...
  })
  .or_else(|| {
    let fallback = format!("{path}/index.html").into(); // 3. <path>/index.html
    ...
  })
  .or_else(|| {
    let fallback = AssetKey::from("index.html");        // 4. index.html
    ...
  })
```

So a request for `/games/730` inside the packaged app resolves to `index.html`
and the client router takes over — exactly what a static host's SPA fallback
does. Step 3 additionally means SvelteKit's prerendered output
(`about/index.html`, `charts/genres/index.html`) is served natively without any
rewrite.

**Consequences:**

- The Tauri build uses **real paths**, same as the web. `HashRouter`,
  `isTauri()`-conditional routing, and the hash-redirect shim the plan held in
  reserve are all unnecessary.
- `adapter-static` with `fallback: 'index.html'` produces output that works
  unmodified on Cloudflare (`not_found_handling: "single-page-application"`)
  **and** in both packaged apps. One build shape, two targets.
- `upgradeLegacyHashUrl()` still has to survive the port: released 1.4.x apps
  and any bookmark made from them hold `/#/…` URLs.

**Confidence, stated honestly.** This is read from the pinned crate source, not
observed at runtime — there is no SvelteKit build to run in a packaged app yet.
It is strong evidence (the code is unambiguous and the version is locked), but
the Phase 7 smoke test must still open `/games/730` in a real desktop and
Android build before the claim is treated as proven. If it somehow fails there,
the fallback plan is unchanged: a `location.hash` → `goto()` shim applied only
to the Tauri build.

**The comment in `web/src/main.tsx` is therefore out of date** — it asserts the
webview "has no server-side fallback". Either Tauri gained one after that was
written, or it was never checked. Whichever, do not carry the claim forward
into the Svelte port.

## Shape of the migration

| Concern | Decision |
|---|---|
| Adapter | `@sveltejs/adapter-static`, `fallback: 'index.html'`, prerender everything it can |
| Worker | unchanged. It keeps owning `/api/*`, `/img/*`, `/admin` via the existing `run_worker_first`; SvelteKit output is just static assets |
| `wrangler.jsonc` | unchanged |
| `/games/[appid]` | prerendered on the web from a build-time read of `../data/*.jsonl` for SEO; **skipped in the Tauri build** (3,400 HTML files would bloat the APK) and served by the fallback instead |
| Volatile fields | `current_players`, `reviews` hydrate client-side from `/api/data/*`, so a daily data commit does not require a rebuild — which is the whole point of the proxy |
| `/admin` | untouched. Still Worker-rendered HTML, outside the SPA entirely |

## What must not be lost in the port

Carried over from the React app, each for a reason that cost something to learn:

- **Never pass `theme="dark"` to an ECharts instance built on `echarts/core`.**
  No themes are registered there, and under echarts 6 an unregistered theme name
  silently stops every series painting while axes and legends still draw.
- **Chunk-load recovery.** A deleted hashed chunk comes back as `index.html`
  with HTTP **200**, so `isChunkLoadError` must keep matching on the MIME-type
  message, not the status.
- **The consent gate** blocks everything except `/error/*`. Any new route that
  must be reachable before consent has to join that list.
- **`schema.ts` mirrors `scripts/core/constants.py`.** `MANUAL_FIELDS`,
  `ARRAY_FIELDS`, `EXTENSION_FIELDS` and the record shape exist in both.
- `appid` is not a stored field — it is parsed out of `link`.
- The numeric-looking fields are formatted strings (`"492,197"`,
  `"86% (Very Positive)"`), so they are parsed before comparison, never
  compared raw.
