/**
 * Source-level rules for the admin SPA, the one page that can commit to the
 * repository. Each is cheap to check here and expensive to discover in review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_API_PREFIX, ADMIN_ROUTES } from "../shared/admin-routes";

const WEB = join(__dirname, "..");

function files(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules" && name !== "generated") out.push(...files(full, exts));
    } else if (exts.some((e) => name.endsWith(e)) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const adminSources = files(join(WEB, "admin", "src"), [".ts", ".svelte"]);
const read = (f: string) => readFileSync(f, "utf-8");
const rel = (f: string) => relative(WEB, f).replaceAll("\\", "/");

describe("admin SPA source rules", () => {
  it("has sources to check", () => {
    expect(adminSources.length).toBeGreaterThan(10);
  });

  it("never renders raw HTML", () => {
    // Every value on these screens (game names, reasons, payloads, audit
    // detail) is text somebody else wrote. Svelte escapes text; these bypass it.
    const offenders = adminSources.filter((f) => /\{@html\b|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write\(/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("never evaluates strings as code", () => {
    const offenders = adminSources.filter((f) => /\beval\(|new Function\(|setTimeout\(\s*["'`]/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("keeps the mock backend out of the app and the Worker", () => {
    const shipped = [...adminSources, ...files(join(WEB, "worker"), [".ts"])];
    const offenders = shipped.filter((f) => /from\s+["'][^"']*admin\/mock|from\s+["']\.\.?\/(\.\.\/)*mock\//.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("takes the queue's rules from shared/queue-rules.ts instead of restating them", () => {
    // The old page carried its own DECIDABLE literal, and a test existed only
    // to keep the two copies equal.
    const offenders = adminSources.filter((f) =>
      /\[\s*["']pending["']\s*,\s*["']deferred["']\s*,\s*["']failed["']\s*\]/.test(read(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("does not reach into SvelteKit, which this build cannot resolve", () => {
    const offenders = adminSources.filter((f) => /from\s+["'](\$app|\$lib|\$env)\//.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("calls its API under /admin, inside the page's own Access application", () => {
    // /api/admin/* sat behind a second Access application. A session for /admin
    // did not cover it, fetch() cannot follow Access's sign-in redirect, and
    // every call failed as "session expired" straight after signing in.
    expect(ADMIN_API_PREFIX.startsWith("/admin/")).toBe(true);
    // One place builds API URLs (lib/api.ts, from the constant); a view that
    // spells out a path could put it back outside /admin.
    const offenders = adminSources.filter((f) => /["'`]\/(api\/admin|admin\/api)\//.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("renders a view for every admin route, and links every route from the nav", () => {
    const app = read(join(WEB, "admin", "src", "App.svelte"));
    const navPaths = [...app.matchAll(/\{\s*path:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(navPaths).toEqual([...ADMIN_ROUTES]);
    for (const route of ADMIN_ROUTES) {
      expect(app, `App.svelte has no branch for ${route}`).toContain(`router.route === "${route}"`);
    }
  });
});

describe("the public app", () => {
  it("never calls the admin API", () => {
    const offenders = files(join(WEB, "src"), [".ts", ".svelte"]).filter((f) => read(f).includes(ADMIN_API_PREFIX));
    expect(offenders.map(rel)).toEqual([]);
  });
});
