/**
 * The PWA (manifest, service worker, `virtual:pwa-register`,
 * `virtual:pwa-info`), wired into SvelteKit 3's build.
 *
 * This replaces @vite-pwa/sveltekit, which never shipped for SvelteKit 3 (its
 * last release, 1.1.0, accepts kit `^1 || ^2`). It does not import SvelteKit
 * at all; what it depends on is the order of SvelteKit 2's builds: it wrote
 * the service worker when the SERVER build closed, which in SvelteKit 2 came
 * after the client build and the prerender. SvelteKit 3 builds through Vite's
 * environment API instead - one `buildApp` hook builds the server, then the
 * client, then prerenders, and a `post`-ordered `buildApp` runs the adapter.
 * The server build now finishes FIRST, so the old hook would glob an output
 * directory with no client and no pages in it.
 *
 * Here the worker is written in a `buildApp` hook of our own. It has the
 * default order and comes after sveltekit() in vite.config.ts, so it runs
 * after SvelteKit's build-and-prerender hook and before the adapter's: the
 * glob sees every prerendered page, and the adapter then copies
 * `.svelte-kit/output/client` - sw.js and workbox-*.js included - into dist/.
 *
 * Everything else is what @vite-pwa/sveltekit 1.1.0 configured, unchanged, so
 * the precache lists the same URLs: the glob runs over `.svelte-kit/output`,
 * `client/` and `prerendered/pages/` are stripped from each entry's URL, a
 * page's `.html` becomes its route (`index.html` -> `/`, `legal/tos.html` ->
 * `legal/tos`), immutable assets are not cache-busted, and the web manifest
 * stays out of the precache.
 */
import path from "node:path";
import type { Plugin } from "vite";
import { VitePWA, type VitePWAOptions, type VitePluginPWAAPI } from "vite-plugin-pwa";

type Workbox = NonNullable<VitePWAOptions["workbox"]>;
type ManifestTransform = NonNullable<Workbox["manifestTransforms"]>[number];

/** SvelteKit's output directory, relative to the Vite root (web/). */
const OUTPUT = ".svelte-kit/output";
/** SvelteKit's `appDir`, where every hashed asset lives under `immutable/`. */
const APP_DIR = "_app";
const WEB_MANIFEST = "manifest.webmanifest";

/** Each glob is added only when the caller has none for that directory. */
function globPatterns(patterns: string[] = []): string[] {
  const out = [...patterns];
  if (!out.some((g) => g.startsWith("prerendered/"))) out.push("prerendered/**/*.{html,json}");
  if (!out.some((g) => g.startsWith("client/"))) out.push("client/**/*.{js,css,ico,png,svg,webp,webmanifest}");
  if (!out.some((g) => g.includes("webmanifest"))) out.push("client/*.webmanifest");
  return out;
}

/** SvelteKit's server bundle sits beside the client and must never be precached. */
function globIgnores(ignores: string[] = []): string[] {
  return ignores.some((g) => g.startsWith("server/")) ? [...ignores] : [...ignores, "server/**"];
}

/** A precache entry's URL as the site serves it, from its path under `.svelte-kit/output`. */
export function entryUrl(file: string): string {
  let url = file;
  for (const prefix of ["client/", "prerendered/dependencies/", "prerendered/pages/"]) {
    if (url.startsWith(prefix)) {
      url = url.slice(prefix.length);
      break;
    }
  }
  if (!url.endsWith(".html")) return url;
  if (url === "index.html") return "/";
  if (url.endsWith("/index.html")) return url.slice(0, -"/index.html".length);
  return url.slice(0, -".html".length);
}

export const manifestTransform: ManifestTransform = async (entries) => ({
  manifest: entries
    // SvelteKit's own SPA fallback, never served under that name.
    .filter(({ url }) => url !== "prerendered/fallback.html")
    .map((entry) => ({ ...entry, url: entryUrl(entry.url) }))
    .filter(({ url }) => url !== WEB_MANIFEST),
});

/**
 * Point workbox at SvelteKit's output. Mutates `workbox` (vite-plugin-pwa reads
 * the options object it was given) and may run more than once, so every step
 * keeps what an earlier run set.
 */
export function configureWorkbox(workbox: Workbox, root: string): void {
  workbox.globDirectory ??= path.posix.join(root.replaceAll("\\", "/"), OUTPUT);
  workbox.globPatterns = globPatterns(workbox.globPatterns);
  workbox.globIgnores = globIgnores(workbox.globIgnores);
  workbox.dontCacheBustURLsMatching ??= new RegExp(`${APP_DIR}/immutable/`);
  workbox.manifestTransforms ??= [manifestTransform];
}

/**
 * vite-plugin-pwa with SvelteKit 3's output layout. Takes the same options as
 * `VitePWA()`; `outDir`, the glob directory and the manifest transform are set
 * here.
 */
export function svelteKitPWA(options: Partial<VitePWAOptions>): Plugin[] {
  const userOptions: Partial<VitePWAOptions> = {
    ...options,
    includeManifestIcons: options.includeManifestIcons ?? false,
    // Where sw.js and workbox-*.js are written: the client output, which the
    // adapter copies into dist/ after this plugin has run.
    outDir: `${OUTPUT}/client`,
    integration: {
      // Runs in vite-plugin-pwa's configResolved, once the root is known.
      configureOptions(viteConfig, resolved) {
        configureWorkbox((resolved.workbox ??= {}), viteConfig.root);
      },
    },
  };

  const plugins = VitePWA(userOptions);
  const main = plugins.find((p) => p.name === "vite-plugin-pwa");
  const api = () => main?.api as VitePluginPWAAPI | undefined;

  return [
    // vite-plugin-pwa's own build plugin writes the worker when a build
    // closes - the wrong moment under SvelteKit, as described above. Its
    // pwa-assets plugin does nothing without a `pwaAssets` option, and SvelteKit
    // warns about its transformIndexHtml hook on every build.
    ...plugins.filter((p) => p.name !== "vite-plugin-pwa:build" && p.name !== "vite-plugin-pwa:pwa-assets"),
    {
      name: "f2p-pwa:sveltekit",
      apply: "build",
      // The web manifest is emitted into the CLIENT output only.
      generateBundle(_, bundle) {
        if (this.environment.name !== "client") return;
        // vite-plugin-pwa types both with Rollup's interfaces; Vite 8 passes
        // Rolldown's, which it handles the same way (@vite-pwa/sveltekit did
        // exactly this).
        api()?.generateBundle(bundle as never, this as never);
      },
      async buildApp() {
        const pwa = api();
        if (!pwa || pwa.disabled) return;
        await pwa.generateSW();
      },
    },
  ];
}
