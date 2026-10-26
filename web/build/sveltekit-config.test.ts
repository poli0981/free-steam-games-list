import { describe, expect, it } from "vitest";
import { sveltekitConfig } from "./sveltekit-config";

/**
 * The SvelteKit options that carry decisions CLAUDE.md explains ("Frontend
 * gotchas"), checked in both flavours without a build. verify-dist.mjs checks
 * the policies as they come out of one.
 */
const web = sveltekitConfig(false);
const tauri = sveltekitConfig(true);

function directive(config: typeof web, name: string): string[] | undefined {
  return (config.csp?.directives as Record<string, string[] | undefined> | undefined)?.[name];
}

function httpErrorHandler(): (details: { path: string; message: string }) => void {
  const handler = web.prerender?.handleHttpError;
  if (typeof handler !== "function") throw new Error("prerender.handleHttpError is not a function");
  return handler as (details: { path: string; message: string }) => void;
}

describe("sveltekitConfig", () => {
  it("keeps asset URLs absolute in both flavours", () => {
    expect(web.paths?.relative).toBe(false);
    expect(tauri.paths?.relative).toBe(false);
  });

  it("builds with adapter-static and prerenders the sitemap nothing links to", () => {
    expect(web.adapter?.name).toBe("@sveltejs/adapter-static");
    expect(web.prerender?.entries).toEqual(["*", "/sitemap.xml"]);
  });

  it("forgives prerender 404s under the Worker's two prefixes and nowhere else", () => {
    const handle = httpErrorHandler();
    expect(() => handle({ path: "/img/d2/730.jpg", message: "404 /img/d2/730.jpg" })).not.toThrow();
    expect(() => handle({ path: "/api/data/data/index.json", message: "404 /api" })).not.toThrow();
    expect(() => handle({ path: "/games/nope", message: "404 /games/nope" })).toThrow("404 /games/nope");
    expect(() => handle({ path: "/imgs/x", message: "404 /imgs/x" })).toThrow();
  });

  it("hashes the bootstrap script rather than allowing inline code", () => {
    expect(web.csp?.mode).toBe("hash");
    expect(directive(web, "script-src")).not.toContain("unsafe-inline");
    expect(directive(tauri, "script-src")).toEqual(["self"]);
  });

  it("lets the web load the beacon, Turnstile and the media host, and nothing more", () => {
    expect(directive(web, "script-src")).toEqual([
      "self",
      "https://static.cloudflareinsights.com",
      "https://challenges.cloudflare.com",
    ]);
    expect(directive(web, "frame-src")).toEqual(["self", "https://challenges.cloudflare.com"]);
    expect(directive(web, "img-src")).toContain("https://media.free-steam-games.win");
    expect(directive(web, "connect-src")).toEqual(["self", "https://cloudflareinsights.com"]);
  });

  it("lets the packaged apps reach the site and GitHub, and none of the web's hosts", () => {
    expect(directive(tauri, "connect-src")).toEqual([
      "self",
      "https://free-steam-games.win",
      "https://api.github.com",
      "ipc:",
      "http://ipc.localhost",
    ]);
    expect(directive(tauri, "img-src")).toContain("https://free-steam-games.win");
    expect(directive(tauri, "img-src")).not.toContain("https://media.free-steam-games.win");
    expect(directive(tauri, "frame-src")).toBeUndefined();
  });
});
