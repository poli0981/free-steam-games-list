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
 * Usage (from web/, after a build):
 *   node scripts/verify-dist.mjs            common checks
 *   node scripts/verify-dist.mjs --web      + web-only expectations
 *   node scripts/verify-dist.mjs --tauri    + packaged-app expectations
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(WEB, "dist");
const flavour = process.argv.includes("--tauri") ? "tauri" : process.argv.includes("--web") ? "web" : "common";

const en = JSON.parse(readFileSync(join(WEB, "src/i18n/locales/en.json"), "utf-8"));

const failures = [];
const fail = (msg) => failures.push(msg);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
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

/** Text a reader or a crawler actually sees: scripts and styles removed. */
function visible(text) {
  return text
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
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

if (failures.length) {
  console.error(`verify-dist (${flavour}): ${failures.length} problem(s)`);
  for (const f of failures.slice(0, 60)) console.error(`  - ${f}`);
  if (failures.length > 60) console.error(`  … and ${failures.length - 60} more`);
  process.exit(1);
}
console.log(`verify-dist (${flavour}): ${html.length} HTML files OK`);
