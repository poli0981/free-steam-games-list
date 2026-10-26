import { describe, expect, it, vi } from "vitest";
import { configureWorkbox, entryUrl, manifestTransform, svelteKitPWA } from "./pwa";

/**
 * build/pwa.ts turns SvelteKit's output paths into precache URLs the way
 * @vite-pwa/sveltekit 1.1.0 did, so the worker keeps precaching what it always
 * did. verify-dist.mjs checks the built sw.js (navigateFallback "/" must be one
 * of its entries); these hold the mapping and the wiring.
 */
describe("entryUrl", () => {
  it.each([
    ["prerendered/pages/index.html", "/"],
    ["prerendered/pages/games.html", "games"],
    ["prerendered/pages/charts/anti-cheat.html", "charts/anti-cheat"],
    ["prerendered/pages/legal/index.html", "legal"],
    ["prerendered/dependencies/sitemap.xml", "sitemap.xml"],
    ["client/_app/immutable/entry/start.CRIF3DB3.js", "_app/immutable/entry/start.CRIF3DB3.js"],
    ["client/icon.svg", "icon.svg"],
  ])("%s -> %s", (file, url) => {
    expect(entryUrl(file)).toBe(url);
  });
});

describe("manifestTransform", () => {
  it("drops SvelteKit's fallback and the web manifest, and maps the rest", async () => {
    const result = await manifestTransform([
      { url: "prerendered/fallback.html", revision: "a", size: 1 },
      { url: "client/manifest.webmanifest", revision: "b", size: 1 },
      { url: "prerendered/pages/index.html", revision: "c", size: 1 },
    ]);
    expect(result.manifest).toEqual([{ url: "/", revision: "c", size: 1 }]);
  });
});

describe("configureWorkbox", () => {
  it("globs SvelteKit's output, and adds each pattern once however often it runs", () => {
    const workbox = { globPatterns: ["**/*.{js,css,html,svg,woff2}"], globIgnores: ["**/og.png"] };
    configureWorkbox(workbox, "E:\\2\\web");
    configureWorkbox(workbox, "E:\\2\\web");
    expect(workbox).toMatchObject({
      globDirectory: "E:/2/web/.svelte-kit/output",
      globPatterns: [
        "**/*.{js,css,html,svg,woff2}",
        "prerendered/**/*.{html,json}",
        "client/**/*.{js,css,ico,png,svg,webp,webmanifest}",
      ],
      globIgnores: ["**/og.png", "server/**"],
      manifestTransforms: [manifestTransform],
    });
  });

  it("does not cache-bust the hashed assets", () => {
    const workbox: Parameters<typeof configureWorkbox>[0] = {};
    configureWorkbox(workbox, "/srv/web");
    expect(workbox.dontCacheBustURLsMatching?.test("_app/immutable/entry/start.CRIF3DB3.js")).toBe(true);
    expect(workbox.dontCacheBustURLsMatching?.test("index.html")).toBe(false);
  });
});

describe("svelteKitPWA", () => {
  const plugins = svelteKitPWA({ registerType: "prompt", injectRegister: false });
  const own = plugins.find((p) => p.name === "f2p-pwa:sveltekit");

  it("swaps vite-plugin-pwa's build step for one inside SvelteKit's buildApp", () => {
    const names = plugins.map((p) => p.name);
    expect(names).toContain("vite-plugin-pwa");
    expect(names).not.toContain("vite-plugin-pwa:build");
    expect(names).not.toContain("vite-plugin-pwa:pwa-assets");
    expect(own?.apply).toBe("build");
    expect(own?.buildApp).toBeTypeOf("function");
  });

  it("emits the web manifest from the client build only", () => {
    const emitFile = vi.fn();
    const generateBundle = own?.generateBundle as (this: unknown, ...args: unknown[]) => void;
    generateBundle.call({ environment: { name: "ssr" }, emitFile }, {}, {});
    expect(emitFile).not.toHaveBeenCalled();
  });
});
