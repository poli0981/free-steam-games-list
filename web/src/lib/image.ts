/**
 * Image URL helpers — routes Steam artwork through the site's own /img/ proxy.
 *
 * Previously thumbnails hit Steam's CDN directly and large images went through
 * images.weserv.nl, a third party. Both are now same-origin: the Worker fetches
 * from Steam and caches at the edge, so no visitor request reaches a
 * third-party host and the privacy policy can say exactly that.
 *
 * Thumbnails (`s`) and the detail hero (`d`) are AVIF for every browser that
 * accepts it, once the Worker's cron has minted the copy into R2; until then,
 * and for browsers without AVIF, they are Steam's JPEG. The social card stays
 * on `d2`, which is always JPEG. worker/routes/img.ts has the variants.
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
import { parseSteamImage, sourceKey } from "../../shared/steam-image";
import { API_ORIGIN as IMG_ORIGIN } from "./site";

/**
 * `s` 230 px and `d` 460 px are negotiated (AVIF or JPEG). `t` and `d2` are
 * the original JPEG and stay for released apps, older pages and social cards.
 */
export type ImageVariant = "s" | "d" | "t" | "d2";

/**
 * Rewrite a Steam header URL to the local proxy. Returns the input unchanged if
 * it does not match the expected shape, so an unexpected URL still renders
 * rather than 404-ing through the proxy.
 */
function proxied(url: string, variant: ImageVariant): string {
  const src = parseSteamImage(url);
  return src ? `${IMG_ORIGIN}/img/${variant}/${sourceKey(src)}` : url;
}

/**
 * Thumbnail for the tables, cards and command palette: 230 px wide, the same
 * aspect as the header (the old `t` variant served Steam's 184x69 capsule on
 * half the catalogue and the full header on the rest, so the two halves
 * cropped differently).
 */
export function headerToCapsule(url: string): string {
  return proxied(url, "s");
}

/**
 * Root-relative /img/ path for a social card, or null when the URL is not a
 * Steam asset the proxy serves. Always without an origin: Seo.svelte prefixes
 * SITE_ORIGIN itself, and in the Tauri build IMG_ORIGIN is already absolute.
 * Deliberately `d2` (always JPEG): a crawler may claim AVIF in Accept and
 * still be unable to render it.
 */
export function socialImagePath(url: string): string | null {
  const src = parseSteamImage(url);
  return src ? `/img/d2/${sourceKey(src)}` : null;
}

/** The detail page's hero: the full 460 px header, AVIF where accepted. */
export function heroImage(url: string): string {
  return proxied(url, "d");
}
