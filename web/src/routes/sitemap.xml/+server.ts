import { SITE_ORIGIN } from "$lib/site";

/**
 * The sitemap, derived from the router itself.
 *
 * It replaces a hand-written static/sitemap.xml that had drifted into
 * uselessness: four URLs, three of which pointed at github.com rather than at
 * this site, and not one of the app's own routes. A crawler following it
 * learned nothing about the site it was crawling.
 *
 * WHY A PRERENDERED ROUTE AND NOT A BUILD SCRIPT
 * The route table is the source of truth. `import.meta.glob` is resolved by
 * Vite at build time against the same files SvelteKit routes on, so adding a
 * page puts it in the sitemap with no second list to remember. A post-build
 * script walking dist/ would work too, but it would have to run after the
 * adapter in every one of the three build scripts, and a missed one fails
 * silently - you get a stale sitemap, not an error.
 *
 * `eager: false` because only the KEYS are wanted. Eager loading would pull
 * every page component into this endpoint's module graph for nothing.
 */
const routes = import.meta.glob("/src/routes/**/+page.svelte", { eager: false });

export const prerender = true;

/**
 * Crawl priority and expected churn. Anything not named here gets the
 * defaults, so a new route needs no entry to be included correctly - only to
 * be ranked differently.
 */
const HINTS: Record<string, { freq: string; priority: string }> = {
  "/": { freq: "daily", priority: "1.0" },
  "/games": { freq: "daily", priority: "0.9" },
  "/top-online": { freq: "daily", priority: "0.8" },
  "/top-offline": { freq: "daily", priority: "0.8" },
  "/stats": { freq: "weekly", priority: "0.8" },
  "/charts": { freq: "weekly", priority: "0.7" },
  "/developers": { freq: "weekly", priority: "0.6" },
  "/publishers": { freq: "weekly", priority: "0.6" },
  "/activity": { freq: "daily", priority: "0.5" },
  "/health": { freq: "daily", priority: "0.4" },
  "/about": { freq: "monthly", priority: "0.5" },
  "/donate": { freq: "monthly", priority: "0.3" },
  "/settings": { freq: "yearly", priority: "0.2" },
  "/welcome": { freq: "monthly", priority: "0.3" },
};

const DEFAULT_HINT = { freq: "weekly", priority: "0.5" };

/** Every static route the glob found. Exported so the test can assert the
 *  sitemap really tracks the router.
 *
 *  The underscore is required, not stylistic: SvelteKit validates the exports
 *  of a +server file and rejects any name that is not an HTTP verb or one of
 *  its own options, unless it is prefixed with "_". */
export function _paths(): string[] {
  const out: string[] = [];
  for (const file of Object.keys(routes)) {
    const path =
      file.replace("/src/routes", "").replace("/+page.svelte", "") || "/";
    // Dynamic segments cannot be enumerated from the route table. /legal/[doc]
    // is added back below from its own manifest; /games/[appid],
    // /developers/[name] and /publishers/[name] are intentionally absent -
    // they are not prerendered and each is one of several thousand near-
    // duplicate pages, which is what a crawler penalises. This also drops
    // /error/[code], which is exactly right: ErrorView sends robots=noindex,
    // so listing it would contradict the page's own tag.
    if (path.includes("[")) continue;
    out.push(path);
  }
  return out.sort();
}

function xml(urls: { loc: string; freq: string; priority: string }[], lastmod: string) {
  const body = urls
    .map(
      (u) =>
        `  <url>\n` +
        `    <loc>${SITE_ORIGIN}${u.loc}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>${u.freq}</changefreq>\n` +
        `    <priority>${u.priority}</priority>\n` +
        `  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export async function GET() {
  // Build time, not the dataset's last_updated: this file is a static artefact
  // of a deploy, and claiming a freshness it cannot have would be worse than
  // claiming none. The daily data commits do not rebuild the site.
  const lastmod = new Date().toISOString().slice(0, 10);

  const { LEGAL_DOCS, legalDocSlug } = await import("$lib/legal");
  const urls = [
    ..._paths().map((loc) => ({ loc, ...(HINTS[loc] ?? DEFAULT_HINT) })),
    ...LEGAL_DOCS.map((d) => ({
      loc: `/legal/${legalDocSlug(d.path)}`,
      freq: "yearly",
      priority: "0.4",
    })),
  ];

  return new Response(xml(urls, lastmod), {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
