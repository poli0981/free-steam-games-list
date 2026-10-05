/**
 * Steam header artwork URLs - the ONE parser shared by the client
 * (src/lib/image.ts builds /img/ URLs from it), the Worker's image route and
 * the cron that mints AVIF copies (worker/lib/img-mint.ts). One definition so
 * the three can never disagree about which records have proxyable art, or
 * about how a version of an image is named.
 *
 * Steam serves this catalogue from two hosts - shared.akamai.steamstatic.com
 * and shared.fastly.steamstatic.com - with the same path layout. The host is
 * dropped here and the Worker tries each.
 */

/** `<appid>/<asset>.jpg` or `<appid>/<40-hex>/<asset>.jpg`, plus Steam's `?t=`. */
export const STEAM_PATH_RE =
  /^https?:\/\/shared\.(?:akamai|fastly)\.steamstatic\.com\/store_item_assets\/steam\/apps\/(\d{1,8}(?:\/[0-9a-f]{40})?\/[a-z0-9_]{1,64}\.jpg)(?:\?t=(\d{1,12}))?/i;

export interface SteamSource {
  /** `<appid>[/<40-hex>]/<asset>.jpg`, as the proxy addresses it. */
  path: string;
  /** Steam's asset mtime (`?t=`), or null when the URL carries none. */
  stamp: string | null;
}

/** The proxyable part of a record's `header_image`, or null for any other URL. */
export function parseSteamImage(url: string): SteamSource | null {
  const m = url ? STEAM_PATH_RE.exec(url) : null;
  return m ? { path: m[1], stamp: m[2] ?? null } : null;
}

/**
 * `path?t=stamp` - the identity of one VERSION of one image. Steam changes
 * `?t=` when the art changes, so a new version is a new key everywhere it is
 * used: the browser's URL, the edge cache and the R2 object.
 */
export function sourceKey(src: SteamSource): string {
  return src.stamp ? `${src.path}?t=${src.stamp}` : src.path;
}
