import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAY_FALL_BACK_ROUTES } from "./fallback-route";

/**
 * Keeps fallback-route.ts's list honest.
 *
 * The list decides whether a page is re-rendered after the host substituted
 * the prerendered dashboard for it. Miss a route and that route silently shows
 * the dashboard - HTTP 200, no console error, correct canonical tag, wrong
 * page. Forget markRouteRendered() in one of them and every real, prerendered
 * visit to it pays a pointless second render.
 *
 * Deriving the list at runtime is not possible: the client bundle has no
 * inventory of which routes were prerendered. So it is written down, and this
 * test holds it against the route files.
 */

const ROUTES = join(process.cwd(), "src", "routes");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Route ids whose page is NOT always prerendered: `prerender` is exported as
 * anything other than the literal `true` - `false`, or a build-mode flag such
 * as the games route's `__PRERENDER_GAMES__`. A route with no export inherits
 * `true` from the root layout.
 */
function routesThatMayFallBack(dir = ROUTES, prefix = ""): string[] {
  const out: string[] = [];
  // withFileTypes: the entry's type comes from the directory listing, not from
  // a stat of the path followed by a read of it (CodeQL js/file-system-race).
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    const full = join(dir, name);
    if (entry.isDirectory()) {
      out.push(...routesThatMayFallBack(full, `${prefix}/${name}`));
    } else if (/^\+page(\.server)?\.ts$/.test(name)) {
      const m = /export const prerender\s*=\s*([^;\n]+)/.exec(stripComments(readFileSync(full, "utf-8")));
      if (m && m[1].trim() !== "true") out.push(prefix || "/");
    }
  }
  return out;
}

describe("the may-fall-back route list", () => {
  const declared = routesThatMayFallBack().sort();

  it("finds the routes that are not always prerendered", () => {
    // Guard on the guard: an empty scan would make the comparison vacuous.
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toContain("/games/[appid]");
  });

  it("matches exactly those routes", () => {
    expect([...MAY_FALL_BACK_ROUTES].sort()).toEqual(declared);
  });

  it("excludes /error/[code], which IS prerendered", () => {
    expect(MAY_FALL_BACK_ROUTES.has("/error/[code]")).toBe(false);
  });

  it.each([...MAY_FALL_BACK_ROUTES])("%s marks itself rendered", (routeId) => {
    const page = join(ROUTES, ...routeId.split("/").filter(Boolean), "+page.svelte");
    const src = stripComments(readFileSync(page, "utf-8"));
    expect(src).toContain(`markRouteRendered("${routeId}")`);
  });
});
