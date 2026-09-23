/**
 * Image URL helpers — routes Steam artwork through the site's own /img/ proxy.
 *
 * Previously thumbnails hit Steam's CDN directly and large images went through
 * images.weserv.nl, a third party. Both are now same-origin: the Worker fetches
 * from Steam and caches at the edge, so no visitor request reaches a
 * third-party host and the privacy policy can say exactly that.
 *
 * The Worker keeps transformations OFF for now (see IMG_TRANSFORM in
 * wrangler.jsonc) — these variants currently select the source asset and the
 * cache key, not a paid resize.
 *
 * EVERY <img> SHOWING THESE URLS SETS referrerpolicy="no-referrer". The zone
 * has Cloudflare Hotlink Protection on, which 403s `/img/*` at the edge -
 * before the Worker ever runs - whenever the Referer names another site, and
 * allows a request with no Referer at all. The packaged apps load from
 * http://tauri.localhost (Windows, Android) or tauri://localhost, and the
 * webview sends that origin as the Referer: every image in the 2.0.0 apps went
 * blank that way. `npm run dev` hit the same 403 through its proxy. On the web
 * these requests are same-origin and would pass either way, so the attribute
 * costs nothing there. src/lib/images.test.ts fails on an <img> without it;
 * docs/SECURITY_SETUP.md section 10 has the measurements.
 */
import { API_ORIGIN as IMG_ORIGIN } from "./site";

/**
 * Steam serves this catalog from two hosts — shared.akamai.steamstatic.com and
 * shared.fastly.steamstatic.com (the latter is ~44% of records). Both share the
 * same path layout, so the host is dropped here and the Worker tries each.
 */
const STEAM_PATH_RE =
  /^https?:\/\/shared\.(?:akamai|fastly)\.steamstatic\.com\/store_item_assets\/steam\/apps\/(\d{1,8}(?:\/[0-9a-f]{40})?\/[a-z0-9_]{1,64}\.jpg)(?:\?t=(\d{1,12}))?/i;

export type ImageVariant = "t" | "d" | "d2";

/**
 * Rewrite a Steam header URL to the local proxy. Returns the input unchanged if
 * it does not match the expected shape, so an unexpected URL still renders
 * rather than 404-ing through the proxy.
 */
function proxied(url: string, variant: ImageVariant): string {
  if (!url) return url;
  const m = STEAM_PATH_RE.exec(url);
  if (!m) return url;
  const [, path, stamp] = m;
  return `${IMG_ORIGIN}/img/${variant}/${path}${stamp ? `?t=${stamp}` : ""}`;
}

/**
 * Thumbnail for the table and command palette.
 *
 * Note the original implementation swapped header.jpg -> capsule_184x69.jpg to
 * save bandwidth. That is NOT done here: roughly 1,600 records use the hashed
 * asset path, where the capsule variant does not exist, so the swap 404s for
 * about half the catalog. Serving the header through the proxy is correct for
 * every record; narrowing it further belongs with the transformation work,
 * which can resize rather than guess at a filename.
 */
export function headerToCapsule(url: string): string {
  return proxied(url, "t");
}

/**
 * Root-relative /img/ path for a social card, or null when the URL is not a
 * Steam asset the proxy serves. Always without an origin: Seo.svelte prefixes
 * SITE_ORIGIN itself, and in the Tauri build IMG_ORIGIN is already absolute.
 */
export function socialImagePath(url: string): string | null {
  const m = url ? STEAM_PATH_RE.exec(url) : null;
  if (!m) return null;
  const [, path, stamp] = m;
  return `/img/d2/${path}${stamp ? `?t=${stamp}` : ""}`;
}

/** Larger image for the detail drawer. */
export function preferWebp(url: string, width?: number): string {
  return proxied(url, width && width > 600 ? "d2" : "d");
}
