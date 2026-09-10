import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Tailwind 4 runs as a Vite plugin instead of a PostCSS plugin;
// tailwind.config.ts and postcss.config.js no longer exist.
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";
import path from "node:path";
import { readFileSync } from "node:fs";

// Version sourced from package.json (single source of truth, matches the Android
// versionName) and exposed to the bundle as `__APP_VERSION__` for the update check.
const appVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
).version as string;

export default defineConfig(({ mode }) => ({
  // Served at the domain root by the Cloudflare Worker, not from a GitHub
  // Pages subpath, so this is "/" in every mode.
  base: "/",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    // `npm run analyze` → dist/stats.html treemap. Vite mode instead of an
    // env var so it works cross-platform without cross-env.
    mode === "analyze" &&
      visualizer({
        filename: "dist/stats.html",
        gzipSize: true,
        brotliSize: true,
        template: "treemap",
      }),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Steam F2P Tracker",
        short_name: "F2P Tracker",
        description:
          "Browse, analyse, and edit the catalog of free-to-play Steam games tracked in this repo.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell. Bigger than default to fit echarts + openpgp chunks.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "/index.html",
        // These are Worker routes, not SPA navigations. Without the denylist an
        // installed service worker answers them from the app shell and they
        // never reach Cloudflare — which for /admin would mean serving the
        // public shell where the Access gate is expected.
        navigateFallbackDenylist: [/^\/api\//, /^\/img\//, /^\/admin/],
        runtimeCaching: [
          // Dataset, now same-origin via the Worker proxy. NetworkFirst so an
          // edit is visible on the next reload: index.json carries
          // last_updated, which is the client's only cache-invalidation
          // signal, and serving it from cache would strand every reader on
          // stale records. Cache name bumped to v3 so clients holding the old
          // raw.githubusercontent entries drop them on activation.
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
          // Artwork via the Worker image proxy. Steam's ?t= is an asset mtime,
          // so a changed image arrives as a different URL and CacheFirst is
          // safe. Status 200 only: caching an opaque 0-status placeholder for
          // 30 days is how a transient upstream failure becomes permanent.
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith("/img/"),
            handler: "CacheFirst",
            options: {
              cacheName: "f2p-img-v1",
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // The one remaining third-party fetch, and only for signed-in users.
          {
            urlPattern: /^https:\/\/avatars\.githubusercontent\.com\/.*/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "gh-avatars",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // echarts/openpgp are NOT grouped here on purpose: they're behind
        // dynamic-import boundaries (LazyEChart, lib/gpg pgp()) and the
        // bundler splits them into async chunks naturally. Forcing them into
        // a manual chunk made the bundler hoist shared helpers (tslib) INTO
        // the echarts chunk, which the eager graph then statically imported —
        // echarts ended up modulepreloaded on first paint, nullifying the
        // lazy boundary.
        //
        // Vite 8 uses Rolldown, which dropped the object form of
        // `manualChunks`. `advancedChunks.groups` is the replacement: each
        // group `test`s a module id and only the three vendor groups below
        // are captured; everything else (incl. echarts/openpgp) falls back to
        // Rolldown's default code splitting, preserving the lazy boundaries.
        advancedChunks: {
          groups: [
            {
              name: "react",
              test: /[\\/]node_modules[\\/](react|react-dom|react-router-dom|react-router|scheduler)[\\/]/,
            },
            {
              name: "query",
              test: /[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
            },
            {
              name: "table",
              test: /[\\/]node_modules[\\/]@tanstack[\\/]react-virtual[\\/]/,
            },
          ],
        },
      },
    },
  },
}));
