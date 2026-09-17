/**
 * The admin SPA's own build. See worker/routes/admin-spa.ts for how it is
 * served and admin/build/emit-worker-bundle.ts for why it is embedded in the
 * Worker instead of dist/.
 *
 *   npm run dev:admin       Vite + HMR on :5174, real handlers, mock backend
 *   npm run build:admin     .admin-build/ -> worker/generated/admin-bundle.ts
 *   npm run preview:admin   the built bundle through the real serveAdmin (CSP)
 */
import path from "node:path";
import { defineConfig } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { emitWorkerBundle } from "./build/emit-worker-bundle";
import { adminDevApi } from "./mock/dev-api";

const WEB = path.resolve(__dirname, "..");

export default defineConfig(({ command, mode }) => ({
  root: __dirname,
  base: "/admin/",
  // No public directory: every asset the admin needs is imported, hashed and
  // embedded. A public/ folder would be copied beside the bundle and never
  // served.
  publicDir: false,
  plugins: [
    tailwindcss(),
    // configFile false: web/svelte.config.js is the SvelteKit app's, and its
    // kit options mean nothing here.
    svelte({ configFile: false, preprocess: vitePreprocess() }),
    command === "serve" && adminDevApi({ preview: mode === "preview" }),
    command === "build" &&
      emitWorkerBundle({
        outDir: path.join(WEB, ".admin-build"),
        target: path.join(WEB, "worker", "generated", "admin-bundle.ts"),
      }),
  ],
  server: {
    port: 5174,
    strictPort: true,
    // The app imports web/src/lib/ui, web/shared and the fonts from
    // web/node_modules, all outside this root.
    fs: { allow: [WEB] },
  },
  build: {
    outDir: path.join(WEB, ".admin-build"),
    emptyOutDir: true,
    target: "es2022",
    // Fonts as files, not data: URIs, so font-src 'self' covers them and the
    // CSS stays small.
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    sourcemap: false,
    rolldownOptions: {
      output: {
        // ONE script. The shell's CSP trusts exactly the script carrying its
        // nonce; a lazily imported chunk would need 'self' or 'strict-dynamic'.
        codeSplitting: false,
        entryFileNames: "assets/app-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
}));
