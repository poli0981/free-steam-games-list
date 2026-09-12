import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LEGAL_DOCS, legalDocSlug } from "./legal";
import { SITE_ORIGIN } from "./site";

/**
 * The head of every page, checked from the outside.
 *
 * These are regression tests for four things that were all true at once and
 * none of which produced an error, a warning, or a failing build:
 *
 *   1. Not one page emitted an Open Graph or Twitter tag, so every link shared
 *      to X, Discord, Slack or iMessage rendered as a bare grey URL.
 *   2. Nothing but /games/[appid] emitted <link rel="canonical">.
 *   3. sitemap.xml listed four URLs, three of them pointing at github.com, and
 *      none of the app's own 30 routes.
 *   4. ChartPage typed `subtitle` as optional, so a chart page could ship with
 *      no meta description and look entirely normal.
 *
 * A missing <head> tag is invisible in the browser. Only a crawler notices,
 * and only weeks later, which is exactly the kind of defect that needs a test
 * rather than a review.
 */

const ROUTES = join(process.cwd(), "src", "routes");

/**
 * Source with comments removed.
 *
 * Without this these tests scan prose as if it were code: the explanatory
 * comment in /error/[code] contains the characters "<title>", and Seo.svelte's
 * own docstring explains why it avoids `page.url.origin` - so both tests
 * failed on the very text that documents the correct behaviour.
 *
 * Only HTML and block comments are stripped. Line comments are left alone
 * because "//" also appears in every https:// URL, and removing those would
 * cause a different false result.
 */
function code(file: string): string {
  return readFileSync(file, "utf-8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every +page.svelte, as a route path: "src/routes/about/+page.svelte" -> "/about". */
function routeFiles(dir = ROUTES, prefix = ""): { path: string; file: string }[] {
  const out: { path: string; file: string }[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...routeFiles(full, `${prefix}/${name}`));
    } else if (name === "+page.svelte") {
      out.push({ path: prefix || "/", file: full });
    }
  }
  return out;
}

describe("every route describes itself", () => {
  const pages = routeFiles();

  it("finds the whole route table", () => {
    // A guard on the guard: if the scan silently returned nothing, every
    // assertion below would vacuously pass.
    expect(pages.length).toBeGreaterThan(25);
  });

  it.each(pages.map((p) => [p.path, p.file]))(
    "%s emits a title and description",
    (_path, file) => {
      const src = code(file);
      // Three legitimate ways a page gets its head:
      //   <Seo …>     directly
      //   <ChartPage> which renders <Seo> from its own title/subtitle props
      //   <ErrorView> which owns the head for /error/[code] and sends noindex
      const owned =
        /<Seo\b/.test(src) || /<ChartPage\b/.test(src) || /<ErrorView\b/.test(src);
      expect(owned).toBe(true);
    },
  );

  it("no page hand-rolls a <title>, which would collide with Seo's", () => {
    // Two <title> elements in one document is not an error - the browser picks
    // one by DOM order - so this can only be caught by looking.
    const offenders = pages
      .filter(({ file }) => /<title>/.test(code(file)))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("Seo.svelte", () => {
  const src = code(join(process.cwd(), "src", "lib", "common", "Seo.svelte"));

  it("builds og:image and og:url from the absolute origin", () => {
    // A relative og:image is not resolved by any crawler: the card just has no
    // image. This is the single most likely way to break social previews while
    // the page still looks perfect in a browser.
    expect(src).toMatch(/ogImage = \$derived\(SITE_ORIGIN \+ image\)/);
    expect(src).toMatch(/SITE_ORIGIN \+ \(p === "\/" \? "\/" : p\.replace/);
  });

  it("does not read the origin off the request", () => {
    // During prerender `page.url.origin` is SvelteKit's internal
    // "http://sveltekit-prerender" host, which would be baked into every
    // static page's canonical tag.
    expect(src).not.toMatch(/page\.url\.origin/);
  });

  it("asks for the large Twitter card", () => {
    expect(src).toContain('content="summary_large_image"');
  });
});

describe("sitemap", () => {
  it("lists every static route, and nothing dynamic", async () => {
    const { _paths } = await import("../routes/sitemap.xml/+server");

    const expected = routeFiles()
      .map((p) => p.path)
      .filter((p) => !p.includes("["))
      .sort();

    expect(_paths()).toEqual(expected);
  });

  it("covers each legal document", async () => {
    const mod = await import("../routes/sitemap.xml/+server");
    const body = await (await mod.GET()).text();
    for (const doc of LEGAL_DOCS) {
      expect(body).toContain(`${SITE_ORIGIN}/legal/${legalDocSlug(doc.path)}`);
    }
  });

  it("emits absolute URLs only", async () => {
    const mod = await import("../routes/sitemap.xml/+server");
    const body = await (await mod.GET()).text();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    expect(locs.length).toBeGreaterThan(25);
    for (const loc of locs) expect(loc.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
  });

  it("points at this site, not at GitHub", async () => {
    // What the hand-written file it replaced actually did: three of its four
    // URLs were github.com links.
    const mod = await import("../routes/sitemap.xml/+server");
    const body = await (await mod.GET()).text();
    expect(body).not.toContain("github.com");
  });
});
