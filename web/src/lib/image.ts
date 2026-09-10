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
 */
import { isTauri } from "./external-open";

/** Must match `vars.SITE_ORIGIN` in web/wrangler.jsonc. */
const SITE_ORIGIN = "https://free-steam-games.win";

/**
 * Same-origin on the web. The Tauri webview loads from tauri://localhost, so a
 * relative path would resolve against the app origin instead of the site.
 */
const IMG_ORIGIN = isTauri() ? SITE_ORIGIN : "";

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

/** Larger image for the detail drawer. */
export function preferWebp(url: string, width?: number): string {
  return proxied(url, width && width > 600 ? "d2" : "d");
}
