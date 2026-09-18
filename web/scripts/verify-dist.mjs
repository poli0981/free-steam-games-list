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

/** One directive of a page's CSP meta tag, as a list of its sources. */
function cspSources(html, directive) {
  const policy = /<meta http-equiv="content-security-policy" content="([^"]*)"/i.exec(html)?.[1] ?? "";
  const found = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive);
  return found ? found.slice(1) : [];
}

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
for (const file of files) {
  if (!TEXT_EXT.test(file)) continue;
  if (readFileSync(file, "utf-8").includes("/api/admin/")) {
    fail(`${relative(DIST, file).replace(/\\/g, "/")}: references /api/admin/ - admin code leaked into the public build`);
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
  if (!cspSources(index, "connect-src").some((source) => source === "https://free-steam-games.win")) {
    fail("index.html CSP does not allow https://free-steam-games.win (the Tauri connect-src)");
  }
}

if (failures.length) {
  console.error(`verify-dist (${flavour}): ${failures.length} problem(s)`);
  for (const f of failures.slice(0, 60)) console.error(`  - ${f}`);
  if (failures.length > 60) console.error(`  … and ${failures.length - 60} more`);
  process.exit(1);
}
console.log(`verify-dist (${flavour}): ${html.length} HTML files OK`);
