import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NOT_PRERENDERED_ROUTES } from "./fallback-route";

/**
 * Keeps fallback-route.ts's list honest.
 *
 * The list is what decides whether a page gets re-rendered after the host
 * substituted the prerendered dashboard for it. Miss a route and that route
 * silently shows the dashboard - HTTP 200, no console error, correct canonical
 * tag, wrong page. Carry a stale entry and every visit to a now-prerendered
 * page pays a pointless extra navigation.
 *
 * Deriving the list at runtime is not possible: the client bundle has no
 * inventory of which routes were prerendered. So it is written down, and this
 * test holds it against the route files.
 */

const ROUTES = join(process.cwd(), "src", "routes");

/** Route id for a route directory: "games/[appid]" -> "/games/[appid]". */
function routesDeclaringNoPrerender(dir = ROUTES, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...routesDeclaringNoPrerender(full, `${prefix}/${name}`));
    } else if (/^\+page(\.server)?\.ts$/.test(name)) {
      const src = readFileSync(full, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (/export const prerender\s*=\s*false/.test(src)) out.push(prefix || "/");
    }
  }
  return out;
}

describe("the not-prerendered route list", () => {
  const declared = routesDeclaringNoPrerender().sort();

  it("finds the routes that opt out", () => {
    // Guard on the guard: an empty scan would make the comparison vacuous.
    expect(declared.length).toBeGreaterThan(0);
  });

  it("matches exactly the routes with prerender = false", () => {
    expect([...NOT_PRERENDERED_ROUTES].sort()).toEqual(declared);
  });

  it("excludes /error/[code], which IS prerendered", () => {
    // /error/[code] is dynamic but prerendered from an explicit entries() list,
    // so it arrives as its own document and must not be re-navigated.
    expect(NOT_PRERENDERED_ROUTES.has("/error/[code]")).toBe(false);
  });
});
