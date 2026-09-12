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
      // NOT "index.html". adapter-static writes the prerendered pages first
      // and then OVERWRITES the fallback's filename - so naming it index.html
      // replaced the prerendered home page with an empty shell, and `/`, the
      // most important page on the site, shipped with zero content. Measured:
      // dist/index.html was 3,403 bytes of comments while every other page had
      // real markup.
      //
      // Consequence to know: Cloudflare's `not_found_handling:
      // "single-page-application"` and Tauri's get_asset both fall back to
      // index.html, which is now the DASHBOARD. An unmatched path therefore
      // gets dashboard markup for one frame before the client router corrects
      // it. That only affects the routes that opt out of prerendering
      // (/games/[appid], /developers/[name], /publishers/[name]), and those
      // are not indexed anyway.
      fallback: "200.html",
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
    /**
     * The Content-Security-Policy, owned HERE rather than in public/_headers.
     *
     * SvelteKit emits exactly one inline <script> per page - the hydration
     * bootstrap - and there is no option to avoid it. Under the header CSP's
     * `script-src 'self'` the browser blocked it, so every page rendered its
     * prerendered HTML and then sat there completely inert. Measured in a real
     * browser: "Executing inline script violates ... script-src 'self'" on
     * every route.
     *
     * mode "hash" makes SvelteKit compute that script's sha256 at build time
     * and emit the whole policy as a <meta> tag that already trusts it. The
     * header CSP could not do this: browsers enforce the INTERSECTION of a
     * header policy and a meta policy, so leaving `script-src 'self'` in
     * _headers would keep blocking the script no matter what the meta said.
     * public/_headers therefore no longer sets a CSP at all.
     *
     * One directive is lost in the move: `frame-ancestors` is ignored in a
     * meta CSP. `X-Frame-Options: DENY` stays in _headers and covers it.
     */
    csp: {
      mode: "hash",
      directives: {
        "default-src": ["self"],
        "script-src": ["self"],
        // 'unsafe-inline' is load-bearing for style-src: Bits UI positions
        // popovers and dialogs with inline style attributes, and ECharts sizes
        // its canvas the same way. Low risk while script-src stays strict,
        // which is the directive that actually stops code execution.
        "style-src": ["self", "unsafe-inline"],
        "img-src": [
          "self",
          "data:",
          "https://shared.akamai.steamstatic.com",
          "https://shared.fastly.steamstatic.com",
          "https://cdn.akamai.steamstatic.com",
        ],
        "font-src": ["self"],
        // 'self' with no exceptions. The Activity page's GitHub call goes
        // through the Worker at /api/activity, and avatars through /img/gh/*.
        "connect-src": ["self"],
        "worker-src": ["self"],
        "manifest-src": ["self"],
        "media-src": ["none"],
        "object-src": ["none"],
        "base-uri": ["none"],
        "form-action": ["none"],
      },
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
