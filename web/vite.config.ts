import { defineConfig, type Plugin } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { SvelteKitPWA } from "@vite-pwa/sveltekit";
// Tailwind 4 runs as a Vite plugin instead of a PostCSS plugin;
// tailwind.config.ts and postcss.config.js do not exist.
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "node:path";
import { readFileSync } from "node:fs";
import { gameSeeds } from "./build/game-seeds";
import { legalVersions } from "./build/legal-versions";

// Version sourced from package.json (single source of truth, matches the Android
// versionName) and exposed to the bundle as `__APP_VERSION__` for the update check.
const appVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
).version as string;

/**
 * True while the Tauri CLI is driving this build. Tauri 2 sets TAURI_ENV_* for
 * the process running beforeBuildCommand. Mirrors the same check in
 * svelte.config.js.
 */
const IS_TAURI = Boolean(process.env.TAURI_ENV_PLATFORM);

/**
 * Prerender one page per game (web only).
 *
 * Off for Tauri: 3,650 HTML files is real APK weight, and the packaged apps
 * resolve /games/<appid> through the SPA fallback anyway. Off when
 * F2P_SKIP_GAME_PRERENDER is set, for quick local builds.
 */
const PRERENDER_GAMES = !IS_TAURI && !process.env.F2P_SKIP_GAME_PRERENDER;

/**
 * The packaged apps omit the PWA plugin entirely (see below), so its virtual
 * modules do not exist there. The app imports them unconditionally, so this
 * resolves both to no-ops for that build.
 */
function pwaVirtualStubs(): Plugin {
  const modules: Record<string, string> = {
    "virtual:pwa-register": "export function registerSW() { return async () => {}; }",
    "virtual:pwa-info": "export const pwaInfo = undefined;",
  };
  return {
    name: "f2p-pwa-stubs",
    resolveId: (id) => (id in modules ? `\0${id}` : null),
    load: (id) => (id.startsWith("\0") ? (modules[id.slice(1)] ?? null) : null),
  };
}

export default defineConfig(({ mode }) => ({
  // No `base`. SvelteKit owns the base path (kit.paths), and setting Vite's
  // would fight it.
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    // Read by routes/games/[appid]/+page.ts. A route file cannot read
    // process.env itself - it also ships to the browser.
    __PRERENDER_GAMES__: JSON.stringify(PRERENDER_GAMES),
  },
  plugins: [
    // Tailwind before sveltekit: the Svelte plugin needs the CSS transform
    // already registered when it processes <style> blocks.
    tailwindcss(),
    gameSeeds({ enabled: PRERENDER_GAMES, dataDir: path.resolve(__dirname, "../data") }),
    // Content hashes for the binding legal documents, so the consent gate can
    // show what changed instead of asking for a second full read. Every
    // flavour: the packaged apps run the same gate.
    legalVersions(),
    sveltekit(),
    /**
     * WEB ONLY. A service worker registered at tauri.localhost can never be
     * updated - Tauri's custom protocol does not satisfy the update
     * algorithm's refetch of the worker script, so the first version a user
     * ever ran keeps serving its precache forever.
     *
     * Measured, not assumed: the 2.0.0 desktop build launched showing the
     * React app, because index.html came from a precache written by an
     * earlier release. Every future release would have shipped invisible.
     *
     * The packaged apps lose nothing: their assets are local files already,
     * and offline DATA lives in the IndexedDB cache in lib/cache.ts.
     * lib/pwa.ts removes any worker left behind by an older build.
     */
    IS_TAURI && pwaVirtualStubs(),
    !IS_TAURI &&
      SvelteKitPWA({
        // "prompt": a new version waits until the reader chooses to reload
        // (lib/common/PwaIndicator.svelte), instead of the page reloading
        // itself mid-read. injectRegister false: nothing was ever injected
        // anyway - SvelteKit has no index.html for the plugin to write a
        // <script> into, which is why the worker was built and never
        // registered. lib/pwa-state.svelte.ts registers it, after consent.
        registerType: "prompt",
        injectRegister: false,
        manifest: {
          name: "Steam F2P Tracker",
          short_name: "F2P Tracker",
          description:
            "Browse and analyse the catalogue of free-to-play Steam games tracked in this repository.",
          theme_color: "#14120F",
          background_color: "#14120F",
          display: "standalone",
          scope: "/",
          start_url: "/",
          // Absolute paths. A relative manifest icon src resolves against the
          // MANIFEST's URL, which is fine at / and wrong the moment the manifest
          // is requested from a deep route - and the SPA fallback answers the
          // miss with index.html at HTTP 200, so it fails silently.
          //
          // "any" and "maskable" are separate entries, not one "any maskable":
          // a maskable icon is padded so Android can crop it to a circle, and
          // reusing that same padded art for "any" leaves a visibly small mark
          // floating in a large box everywhere else.
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          ],
        },
        workbox: {
          // Big enough for the echarts chunk, which is ~700 KB on its own.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ["**/*.{js,css,html,svg,woff2}"],
          // The social card is 145 KB that no VISITOR ever loads - it exists
          // for crawlers. @vite-pwa/sveltekit adds every static asset to the
          // precache on its own, regardless of globPatterns, so keeping it
          // out of every install takes an explicit ignore.
          // The prerendered game pages: ~3,650 HTML files, ~120 MB. The glob
          // runs over .svelte-kit/output, not dist, and without this every
          // install would precache all of them.
          globIgnores: ["**/og.png", "prerendered/pages/games/**", "**/games/*.html"],
          // "/" — the prerendered dashboard — and NOT "/200.html", which the
          // precache does not contain and cannot contain. adapter-static
          // writes 200.html with generateFallback() straight into dist/,
          // AFTER workbox has globbed .svelte-kit/output; there is no
          // 200.html under .svelte-kit at all. So createHandlerBoundToURL()
          // threw `non-precached-url` on every load, taking the rest of the
          // worker's top-level setup with it.
          //
          // "/" is the right target anyway: it is exactly what BOTH hosts
          // already serve for an unmatched path (Cloudflare's
          // not_found_handling: "single-page-application", and Tauri's
          // get_asset() chain), so the offline fallback now behaves like the
          // online one and lib/fallback-route.ts re-renders the real route.
          // verify-dist.mjs fails the build if this ever names a URL the
          // precache manifest does not list.
          navigateFallback: "/",
          // These are Worker routes, not app navigations. Without the denylist an
          // installed service worker answers them from the app shell and they
          // never reach Cloudflare - which for /admin means serving the public
          // shell where the Access gate is expected.
          navigateFallbackDenylist: [/^\/api\//, /^\/img\//, /^\/admin/],
          runtimeCaching: [
            // NO rule for /api/data/*. It used to be NetworkFirst with a 5 s
            // timeout, so a slow index.json came back from this cache and the
            // client took an old generation for the current one. The dataset's
            // offline copy is IndexedDB, which games-loader.ts writes only once
            // every shard has matched index.json's sha256 - and shards requested
            // by hash are immutable HTTP responses the browser cache already
            // handles. lib/pwa.ts deletes the old "f2p-data-v3" cache.
            // Artwork AND the GitHub avatars at /img/gh/*, which share the prefix.
            // Steam's ?t= is an asset mtime, so a changed image arrives as a
            // different URL and CacheFirst is safe. Status 200 only: caching an
            // opaque 0-status placeholder for 30 days is how a transient upstream
            // failure becomes permanent.
            {
              urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith("/img/"),
              handler: "CacheFirst",
              options: {
                cacheName: "f2p-img-v1",
                expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    // `npm run analyze` → dist/stats.html treemap. Vite mode instead of an
    // env var so it works cross-platform without cross-env.
    mode === "analyze" &&
      visualizer({
        filename: "dist/stats.html",
        gzipSize: true,
        brotliSize: true,
        template: "treemap",
      }),
  ],
  // `vite dev` serves the app shell for any unmatched path, so without this
  // /api/data/* and /img/* return text/html: the dataset fetch parses HTML as
  // JSON and throws, while every image 404s into the shell. Proxying to the
  // deployed Worker keeps `npm run dev` working with real data and real images
  // while still hot-reloading app code.
  //
  // This does NOT exercise worker/ source — changes there must be run with
  // `wrangler dev`, which serves the Worker and dist/ together.
  server: {
    proxy: {
      "/api": { target: "https://free-steam-games.win", changeOrigin: true },
      "/img": { target: "https://free-steam-games.win", changeOrigin: true },
    },
  },
  build: {
    // Raised from es2020: Svelte 5's compiled output and SvelteKit 2 both
    // assume a modern baseline, and the Android floor is already API 30, whose
    // System WebView handles ES2022.
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
}));
