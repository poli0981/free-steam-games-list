import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { SvelteKitPWA } from "@vite-pwa/sveltekit";
// Tailwind 4 runs as a Vite plugin instead of a PostCSS plugin;
// tailwind.config.ts and postcss.config.js do not exist.
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import path from "node:path";
import { readFileSync } from "node:fs";

// Version sourced from package.json (single source of truth, matches the Android
// versionName) and exposed to the bundle as `__APP_VERSION__` for the update check.
const appVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
).version as string;

export default defineConfig(({ mode }) => ({
  // No `base`. SvelteKit owns the base path (kit.paths), and setting Vite's
  // would fight it.
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    // Tailwind before sveltekit: the Svelte plugin needs the CSS transform
    // already registered when it processes <style> blocks.
    tailwindcss(),
    sveltekit(),
    SvelteKitPWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Steam F2P Tracker",
        short_name: "F2P Tracker",
        description:
          "Browse and analyse the catalogue of free-to-play Steam games tracked in this repository.",
        theme_color: "#131110",
        background_color: "#131110",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Big enough for the echarts chunk, which is ~700 KB on its own.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "/200.html",
        // These are Worker routes, not app navigations. Without the denylist an
        // installed service worker answers them from the app shell and they
        // never reach Cloudflare - which for /admin means serving the public
        // shell where the Access gate is expected.
        navigateFallbackDenylist: [/^\/api\//, /^\/img\//, /^\/admin/],
        runtimeCaching: [
          // The dataset. NetworkFirst so an edit is visible on the next reload:
          // index.json carries last_updated, the client's only
          // cache-invalidation signal, and serving THAT from cache would strand
          // every reader on stale records.
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith("/api/data/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "f2p-data-v3",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
            },
          },
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
