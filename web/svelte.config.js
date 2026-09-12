import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * One adapter, two targets.
 *
 * `adapter-static` with a fallback produces output that works unmodified in
 * both places this app ships:
 *
 *   - Cloudflare, where `not_found_handling: "single-page-application"` in
 *     wrangler.jsonc already serves index.html for an unmatched path, and the
 *     hand-written Worker keeps owning /api/*, /img/* and /admin through
 *     `run_worker_first`. Nothing about the Worker changes for this migration.
 *   - The Tauri desktop and Android builds, where
 *     `tauri::manager::get_asset()` resolves a miss through <path>.html, then
 *     <path>/index.html, then index.html. See docs/plan/15-sveltekit-migration.md
 *     for the source and the version it was read from.
 *
 * That second point is why there is no HashRouter here and no hash shim. The
 * comment in the old React main.tsx claiming the webview has no server
 * fallback is out of date.
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      // dist/, not build/: wrangler.jsonc's assets.directory and Tauri's
      // frontendDist both already point here, and changing them would mean
      // touching deploy config for no gain.
      pages: "dist",
      assets: "dist",
      fallback: "index.html",
      precompress: false,
      // Not strict: /games/[appid] is deliberately NOT prerendered in the
      // Tauri build (3,400 HTML files would bloat the APK), and strict mode
      // treats a route with no prerendered entry as an error even when a
      // fallback exists to serve it.
      strict: false,
    }),
    alias: {
      // The React app used "@/..." for src-relative imports. Kept so a ported
      // file does not have to rewrite every import path at the same time as
      // its rendering.
      "@": "src",
    },
    typescript: {
      config(cfg) {
        // The generated config is what svelte-check uses. The Worker and the
        // tests have their own tsconfigs; this one must not try to typecheck
        // either of them.
        cfg.exclude = [...(cfg.exclude ?? []), "../worker/**"];
        return cfg;
      },
    },
  },
};

export default config;
