import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";
import path from "node:path";

const repoName = "free-steam-games-list";

export default defineConfig(({ command, mode }) => ({
  base: command === "build" ? `/${repoName}/` : "/",
  plugins: [
    react(),
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
        scope: command === "build" ? `/${repoName}/` : "/",
        start_url: command === "build" ? `/${repoName}/` : "/",
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
        // 404.html is GitHub Pages' error document for paths outside the
        // SPA — precaching it would be wasted bytes (SW-controlled clients
        // get navigateFallback to index.html and never see it).
        globIgnores: ["404.html"],
        navigateFallback: command === "build" ? `/${repoName}/index.html` : "/index.html",
        runtimeCaching: [
          // Raw shard data — NetworkFirst so an edit lands on disk → next page
          // load fetches the fresh shard, with cache fallback when offline.
          // Old StaleWhileRevalidate strategy made edits appear only after TWO
          // reloads (cached on first, refreshed in background, returned on
          // second). Using NetworkFirst with a short timeout keeps offline UX
          // intact while making edits visible on the next reload.
          //
          // The cache name is bumped to `f2p-data-v2` so users with a stale
          // SW automatically discard the old entries on activation rather
          // than serving them from the legacy `f2p-data` cache.
          {
            urlPattern:
              /^https:\/\/raw\.githubusercontent\.com\/poli0981\/free-steam-games-list\/main\/data\/.*/,
            handler: "NetworkFirst",
            options: {
              cacheName: "f2p-data-v2",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Steam header images — long-lived; just cache.
          {
            urlPattern:
              /^https:\/\/shared\.akamai\.steamstatic\.com\/.*\.jpg/,
            handler: "CacheFirst",
            options: {
              cacheName: "steam-headers",
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // images.weserv.nl WebP transcodes — same long-lived caching, but
          // restrict to status 200 so a 502 from the proxy doesn't get cached
          // as an opaque 0-status placeholder for 30 days.
          {
            urlPattern: /^https:\/\/images\.weserv\.nl\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "weserv-webp",
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // GitHub user/avatar — cache short.
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
