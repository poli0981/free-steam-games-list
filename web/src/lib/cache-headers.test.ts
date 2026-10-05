import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * static/_headers decides how long browsers keep the static files. Two
 * mistakes are expensive and silent: a long lifetime on something whose name
 * does not change (HTML, sw.js, version.json - a deploy or a changed legal
 * document would not show up), and two rules giving one path a Cache-Control
 * (the platform joins them with a comma).
 */

interface Rule {
  pattern: string;
  headers: Record<string, string>;
}

function parseHeaders(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: raw.trim(), headers: {} });
      continue;
    }
    const m = /^\s+([A-Za-z-]+):\s*(.*)$/.exec(raw);
    if (m && rules.length) rules[rules.length - 1].headers[m[1].toLowerCase()] = m[2];
  }
  return rules;
}

/** `_headers` splats: `*` matches anything, including slashes. */
function matches(pattern: string, path: string): boolean {
  const re = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(path);
}

const rules = parseHeaders(readFileSync(join(__dirname, "..", "..", "static", "_headers"), "utf-8"));

function cacheControlFor(path: string): string[] {
  return rules.filter((r) => matches(r.pattern, path) && r.headers["cache-control"]).map((r) => r.headers["cache-control"]);
}

describe("static cache headers", () => {
  it("caches hashed build output for a year, immutably", () => {
    for (const path of [
      "/_app/immutable/entry/start.LWk3BKaK.js",
      "/_app/immutable/assets/0.BGvNULEu.css",
      "/_app/immutable/assets/ibm-plex-sans-latin-wght-normal.IvpUvPa2.woff2",
      "/workbox-35e397ac.js",
    ]) {
      expect(cacheControlFor(path), path).toEqual(["public, max-age=31536000, immutable"]);
    }
  });

  it("never caches pages, the service worker or the version signal", () => {
    for (const path of ["/", "/games/730", "/settings", "/legal/tos", "/sw.js", "/_app/version.json", "/200.html"]) {
      expect(cacheControlFor(path), path).toEqual([]);
    }
  });

  it("keeps renamed-never art revalidatable, not immutable", () => {
    for (const path of ["/icon.svg", "/icon-192.png", "/icon-maskable-512.png", "/favicon-32.png", "/apple-touch-icon.png", "/og.png", "/manifest.webmanifest"]) {
      const cc = cacheControlFor(path);
      expect(cc, path).toHaveLength(1);
      expect(cc[0], path).not.toContain("immutable");
      expect(cc[0], path).toContain("stale-while-revalidate");
    }
  });

  it("gives no path two Cache-Control rules", () => {
    const paths = ["/robots.txt", "/sitemap.xml", "/og.png", "/icon.svg", "/workbox-1.js", "/_app/immutable/x.js"];
    for (const path of paths) expect(cacheControlFor(path).length, path).toBeLessThanOrEqual(1);
  });
});
