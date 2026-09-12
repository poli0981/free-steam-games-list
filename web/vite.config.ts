import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
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
