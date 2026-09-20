#!/usr/bin/env node
/**
 * Checks the BUILT site for mistakes that exist only in prerendered HTML.
 *
 * Every one of these shipped at least once, and none of them is visible in dev
 * or in a unit test, because they come from rendering a page with no browser,
 * no localStorage and no data:
 *
 *   - a literal "{{total}}" in a meta description (a t() call without its
 *     variables),
 *   - "Overview of 0 F2P Steam games" (a count interpolated before any data),
 *   - "No game matches these filters." as the prerendered body of /games
 *     (an empty state shown because `loading` is false before a load starts),
 *   - the full consent dialog in every page (the gate rendered before storage
 *     was read).
 *
 * It also fails if any part of the admin SPA reached dist/.
 *
 * Usage (from web/, after a build):
 *   node scripts/verify-dist.mjs            common checks
 *   node scripts/verify-dist.mjs --web      + web-only expectations
 *   node scripts/verify-dist.mjs --tauri    + packaged-app expectations
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(WEB, "dist");
const flavour = process.argv.includes("--tauri") ? "tauri" : process.argv.includes("--web") ? "web" : "common";

const en = JSON.parse(readFileSync(join(WEB, "src/i18n/locales/en.json"), "utf-8"));

const failures = [];
const fail = (msg) => failures.push(msg);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error(`verify-dist: ${DIST} does not exist - build first.`);
  process.exit(1);
}

const files = walk(DIST);
const html = files.filter((f) => f.endsWith(".html"));

if (!existsSync(join(DIST, "200.html"))) fail("200.html (the SPA fallback) is missing");
if (html.length < 10) fail(`only ${html.length} HTML files - prerendering did not run`);

/**
 * Text a reader or a crawler actually sees: the page minus every <script> and
 * <style> element. Found by scanning, not by regex replacement, so a tag split
 * or nested to dodge one pattern cannot leave a remnant, and an end tag with
 * whitespace or attributes (`</script >`) still ends its element. An element
 * with no end tag hides the rest of the page, as it would in a browser.
 */
function visible(text) {
  // ASCII only. A full toLowerCase() can change the length ("İ" becomes two
  // code units), and an index found in `lower` would then cut `text` in the
  // wrong place.
  const lower = text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
  const isTagEnd = (at) => at >= lower.length || /[\s/>]/.test(lower[at]);
  const opening = (from) => {
    for (let at = lower.indexOf("<", from); at !== -1; at = lower.indexOf("<", at + 1)) {
      for (const name of ["script", "style"]) {
        if (lower.startsWith(name, at + 1) && isTagEnd(at + 1 + name.length)) return { at, name };
      }
    }
    return null;
  };
  let out = "";
  let cursor = 0;
  for (let open = opening(0); open; open = opening(cursor)) {
    out += text.slice(cursor, open.at);
    let close = lower.indexOf(`</${open.name}`, open.at);
    while (close !== -1 && !isTagEnd(close + 2 + open.name.length)) close = lower.indexOf(`</${open.name}`, close + 1);
    if (close === -1) return out;
    const tagEnd = lower.indexOf(">", close);
    if (tagEnd === -1) return out;
    cursor = tagEnd + 1;
  }
  return out + text.slice(cursor);
}

/**
 * Whether a CSP directive lists this source EXACTLY.
 *
 * `.includes(host)` on the array would mean the same thing, but CodeQL reads
 * it as a substring test on a URL and files a high-severity alert - and the
 * distinction it is worried about is a real one here, so the check is written
 * so that neither a reader nor an analyser has to work out which `includes`
 * this is. `https://evil.com/?x=https://cloudflareinsights.com` must not pass.
 */
function cspAllows(html, directive, source) {
  return cspSources(html, directive).some((s) => s === source);
}

/** One directive of a page's CSP meta tag, as a list of its sources. */
function cspSources(html, directive) {
  const policy = /<meta http-equiv="content-security-policy" content="([^"]*)"/i.exec(html)?.[1] ?? "";
  const found = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive);
  return found ? found.slice(1) : [];
}

/**
 * The service worker's navigation fallback must be a URL it actually precached.
 *
 * It was not. `navigateFallback: "/200.html"` named the adapter-static
 * fallback, which generateFallback() writes into dist/ AFTER workbox has
 * globbed .svelte-kit/output - so the precache manifest never contained it and
 * createHandlerBoundToURL() threw `non-precached-url` on every page load,
 * abandoning the rest of the worker's top-level setup. Nothing in the build
 * noticed: sw.js existed, was valid JavaScript, and only failed at runtime.
 *
 * Precache entries are spelled as the route URL with no leading slash
 * (`about`, `legal/tos`), except the home page, which is `/`.
 */
function assertNavigateFallbackIsPrecached(sw) {
  const bound = /createHandlerBoundToURL\("([^"]*)"\)/.exec(sw);
  if (!bound) {
    fail("sw.js registers no navigation fallback (createHandlerBoundToURL is gone)");
    return;
  }
  const url = bound[1];
  const entry = url === "/" ? "/" : url.replace(/^\//, "");
  if (!sw.includes(`url:"${entry}"`)) {
    fail(`sw.js: navigateFallback "${url}" is not in the precache manifest`);
  }
}

// Cloudflare Web Analytics: the script's host and the host its beacon posts to.
const BEACON_SCRIPT_HOST = "https://static.cloudflareinsights.com";
const BEACON_CONNECT_HOST = "https://cloudflareinsights.com";

// Strings that must never be baked into a page before data exists.
const BAKED_EMPTY_STATES = [en.games.noResults, en.health.allClear, en.studios.notFound];
const CONSENT_TITLE = en.consent.title;

for (const file of html) {
  const rel = relative(DIST, file).replace(/\\/g, "/");
  const text = readFileSync(file, "utf-8");
  const seen = visible(text);

  const placeholder = /\{\{\s*\w+\s*\}\}/.exec(seen);
  if (placeholder) fail(`${rel}: unfilled placeholder ${placeholder[0]}`);

  const zero = /content="0 [^"]*"/.exec(text);
  if (zero) fail(`${rel}: count baked in as zero: ${zero[0]}`);

  for (const phrase of BAKED_EMPTY_STATES) {
    if (seen.includes(phrase)) fail(`${rel}: prerendered empty state "${phrase}"`);
  }
  if (seen.includes(CONSENT_TITLE)) fail(`${rel}: prerendered consent dialog ("${CONSENT_TITLE}")`);
}

/* ── the admin never ships in dist/ ───────────────────────────────────── */

// dist/ is served to anyone, precached by the service worker and packaged into
// the Tauri apps. The admin SPA is embedded in the Worker instead
// (admin/build/emit-worker-bundle.ts), so no trace of it may appear here.
if (existsSync(join(DIST, "admin"))) fail("dist/admin exists - the admin SPA must only be served by the Worker");
const TEXT_EXT = /\.(html|js|mjs|css|json|webmanifest|txt|xml|map)$/;
// ADMIN_API_PREFIX in shared/admin-routes.ts, which a plain .mjs cannot import.
const ADMIN_API_PREFIX = "/admin/api/";
for (const file of files) {
  if (!TEXT_EXT.test(file)) continue;
  if (readFileSync(file, "utf-8").includes(ADMIN_API_PREFIX)) {
    fail(`${relative(DIST, file).replace(/\\/g, "/")}: references ${ADMIN_API_PREFIX} - admin code leaked into the public build`);
  }
}

/* ── per-flavour expectations ─────────────────────────────────────────── */

const gamesDir = join(DIST, "games");
const gamePages = existsSync(gamesDir)
  ? readdirSync(gamesDir).filter((n) => /^\d+\.html$/.test(n))
  : [];

if (flavour === "web") {
  // One prerendered page per game (routes/games/[appid]/+page.ts). A build
  // that silently produced none would ship a site crawlers see as empty.
  if (gamePages.length < 3000) fail(`only ${gamePages.length} prerendered game pages (expected 3,000+)`);
  for (const name of gamePages) {
    const text = readFileSync(join(gamesDir, name), "utf-8");
    if (!text.includes('id="game-seed"')) fail(`games/${name}: no #game-seed block (hydration would not match)`);
    if (!text.includes('type="application/ld+json"')) fail(`games/${name}: no JSON-LD`);
  }
  // The installable web app: the manifest must be linked from the page, or
  // the service worker registers but the browser never offers installation.
  const home = readFileSync(join(DIST, "index.html"), "utf-8");
  if (!/<link rel="manifest"/.test(home)) fail('index.html has no <link rel="manifest">');
  if (!existsSync(join(DIST, "sw.js"))) fail("sw.js was not generated");
  else assertNavigateFallbackIsPrecached(readFileSync(join(DIST, "sw.js"), "utf-8"));

  // The analytics beacon (lib/analytics.ts) is appended at runtime, so the
  // only thing a built page can prove is that the policy would let it load.
  // It went unnoticed for months that the edge-injected version could not:
  // nothing in the build looked at script-src.
  if (!cspAllows(home, "script-src", BEACON_SCRIPT_HOST)) {
    fail(`index.html CSP script-src does not allow ${BEACON_SCRIPT_HOST} (the analytics beacon)`);
  }
  if (!cspAllows(home, "connect-src", BEACON_CONNECT_HOST)) {
    fail(`index.html CSP connect-src does not allow ${BEACON_CONNECT_HOST} (the analytics beacon)`);
  }

  // A universal load, not a server load: a __data.json here would mean client
  // navigation fetches one per game, and 404s (as index.html) for new games.
  if (files.some((f) => f.endsWith("__data.json") && f.includes(`${join("dist", "games")}`))) {
    fail("games/*/__data.json exists - the game route must not have a server load");
  }
}

if (flavour === "tauri") {
  // 3,650 HTML files is real APK weight; the packaged apps use the fallback.
  if (gamePages.length > 0) fail(`${gamePages.length} game pages in a Tauri build (expected none)`);
  // A service worker at tauri.localhost can never update (see lib/pwa.ts).
  if (existsSync(join(DIST, "sw.js"))) fail("sw.js exists in a Tauri build");
  if (/<link rel="manifest"/.test(readFileSync(join(DIST, "index.html"), "utf-8"))) {
    fail("index.html links a web manifest in a Tauri build");
  }
  // An exact source in connect-src, not a substring of the page: the origin
  // appearing anywhere else (a link, a longer host) must not pass.
  const index = readFileSync(join(DIST, "index.html"), "utf-8");
  if (!cspAllows(index, "connect-src", "https://free-steam-games.win")) {
    fail("index.html CSP does not allow https://free-steam-games.win (the Tauri connect-src)");
  }
  // The packaged apps must not phone an analytics beacon. lib/analytics.ts
  // returns early under isTauri(), and the policy backs that up.
  for (const [directive, host] of [
    ["script-src", BEACON_SCRIPT_HOST],
    ["connect-src", BEACON_CONNECT_HOST],
  ]) {
    if (cspAllows(index, directive, host)) {
      fail(`index.html CSP ${directive} allows ${host} in a Tauri build`);
    }
  }
}

if (failures.length) {
  console.error(`verify-dist (${flavour}): ${failures.length} problem(s)`);
  for (const f of failures.slice(0, 60)) console.error(`  - ${f}`);
  if (failures.length > 60) console.error(`  … and ${failures.length - 60} more`);
  process.exit(1);
}
console.log(`verify-dist (${flavour}): ${html.length} HTML files OK`);
