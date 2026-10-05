import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { withoutBlockComments } from "./testing/source";
import { MEDIA_ORIGIN } from "./site";

/**
 * Every <img> sends no Referer.
 *
 * Cloudflare Hotlink Protection is on for the zone. It answers /img/* with a
 * 403 whenever the Referer names another site, at the edge and before the
 * Worker runs, so nothing in worker/ can help - and it lets a request with NO
 * Referer through. The Tauri webviews send their own origin as the Referer
 * (http://tauri.localhost on Windows and Android), so every image in the 2.0.0
 * desktop app came back 403 and rendered as a broken icon. Security Events
 * showed it; the app itself said nothing.
 *
 * The admin SPA is scanned too. Its thumbnail already opted out, and a new
 * image there should as well.
 */

const WEB = process.cwd();
const ROOTS = [join(WEB, "src"), join(WEB, "admin", "src")];

function svelteFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) svelteFiles(full, acc);
    else if (name.endsWith(".svelte")) acc.push(full);
  }
  return acc;
}

/**
 * Each `<img ...>` start tag, attributes and all.
 *
 * Scanned rather than matched with `<img[^>]*>`: an attribute can hold an
 * arrow function (`onerror={() => ...}`), whose `>` would end that match early
 * and hide every attribute after it. A `>` only closes the tag outside braces
 * and quotes.
 */
function imgTags(text: string): string[] {
  const src = withoutBlockComments(text);
  const tags: string[] = [];
  for (let at = src.indexOf("<img"); at !== -1; at = src.indexOf("<img", at + 4)) {
    if (!/[\s/>]/.test(src[at + 4] ?? "")) continue;
    let depth = 0;
    let quote: string | null = null;
    let end = at + 4;
    for (; end < src.length; end++) {
      const c = src[end];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
      } else if (c === ">" && depth === 0) {
        break;
      }
    }
    tags.push(src.slice(at, end + 1));
  }
  return tags;
}

describe("every <img> sends no Referer", () => {
  const found = ROOTS.flatMap((root) => svelteFiles(root)).flatMap((file) =>
    imgTags(readFileSync(file, "utf-8")).map((tag) => ({
      file: relative(WEB, file).replace(/\\/g, "/"),
      tag,
    })),
  );

  it("finds the images it is meant to check", () => {
    // Ten in the public app and one in the admin. Guards against a scanner
    // that silently matches nothing and passes.
    expect(found.length).toBeGreaterThanOrEqual(11);
  });

  it('sets referrerpolicy="no-referrer" on each of them', () => {
    const missing = found
      .filter(({ tag }) => !/\sreferrerpolicy="no-referrer"/.test(tag))
      .map(({ file, tag }) => `${file}: ${tag.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(missing).toEqual([]);
  });
});

/**
 * Every image that loads from the media host can fall back to /img.
 *
 * headerToCapsule() and heroImage() point at the R2 bucket's custom domain on
 * the web, which answers 404 for a game the cron has not minted yet, and a
 * browser without AVIF cannot decode what it does answer. imgFallback is
 * what turns either into Steam's JPEG; an <img> without it is a broken image
 * for every new game. The fallback must be built from the same record field,
 * or a row would fall back to another game's art.
 */
describe("every media-host image can fall back to /img", () => {
  const PAIRS: Record<string, string> = { headerToCapsule: "thumbFallback", heroImage: "heroFallback" };
  const found = ROOTS.flatMap((root) => svelteFiles(root)).flatMap((file) =>
    imgTags(readFileSync(file, "utf-8"))
      .map((tag) => ({ file: relative(WEB, file).replace(/\\/g, "/"), tag }))
      .filter(({ tag }) => /\ssrc=\{(headerToCapsule|heroImage)\(/.test(tag)),
  );

  it("finds the images it is meant to check", () => {
    // Eight thumbnails and the detail hero.
    expect(found.length).toBeGreaterThanOrEqual(9);
  });

  it("gives each one {@attach imgFallback(...)}, built from the same value", () => {
    const wrong = found
      .filter(({ tag }) => {
        const src = /\ssrc=\{(headerToCapsule|heroImage)\(([^()]+)\)\}/.exec(tag);
        if (!src) return true;
        const fallback = /\{@attach imgFallback\((\w+)\(([^()]+)\)\)\}/.exec(tag);
        return !fallback || fallback[1] !== PAIRS[src[1]] || fallback[2].trim() !== src[2].trim();
      })
      .map(({ file, tag }) => `${file}: ${tag.replace(/\s+/g, " ").slice(0, 160)}`);
    expect(wrong).toEqual([]);
  });

  it("is allowed by the web CSP and checked by verify-dist, under the same name as lib/site.ts", () => {
    // svelte.config.js and verify-dist.mjs are plain Node and cannot import
    // site.ts, so the literal is repeated there; this keeps the three equal.
    // A web policy without the host blocks every image, the fallback hides it,
    // and every view costs a Worker request again.
    for (const file of ["svelte.config.js", "scripts/verify-dist.mjs"]) {
      expect(readFileSync(join(WEB, file), "utf-8"), file).toContain(`"${MEDIA_ORIGIN}"`);
    }
  });
});
