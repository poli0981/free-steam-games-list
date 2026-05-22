import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

const repoName = "free-steam-games-list";

export default defineConfig(({ command }) => ({
  base: command === "build" ? `/${repoName}/` : "/",
  plugins: [
    react(),
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
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          table: ["@tanstack/react-virtual"],
          echarts: ["echarts", "echarts-for-react"],
          openpgp: ["openpgp"],
        },
      },
    },
  },
}));
