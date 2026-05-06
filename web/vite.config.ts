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
          // Raw shard data — stale-while-revalidate so offline users see the
          // last-known catalog and online users get fresh data shortly after.
          {
            urlPattern:
              /^https:\/\/raw\.githubusercontent\.com\/poli0981\/free-steam-games-list\/main\/data\/.*/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "f2p-data",
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
          table: ["@tanstack/react-table", "@tanstack/react-virtual"],
          echarts: ["echarts", "echarts-for-react"],
          openpgp: ["openpgp"],
        },
      },
    },
  },
}));
