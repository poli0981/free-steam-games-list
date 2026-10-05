/**
 * Image URL helpers - Steam artwork, served first-party.
 *
 * Previously thumbnails hit Steam's CDN directly and large images went through
 * images.weserv.nl, a third party. Now no visitor request reaches a
 * third-party host, and the privacy policy can say exactly that:
 *
 *  - On the web, thumbnails (`s`) and the detail hero (`d`) come straight from
 *    the R2 bucket's custom domain (MEDIA_ORIGIN): the AVIF copies the Worker's
 *    cron minted, served out of Cloudflare's cache. A Worker always runs BEFORE
 *    that cache, so this is the only way a repeat view costs neither a Worker
 *    invocation nor an R2 read.
 *  - Every such <img> carries `{@attach imgFallback(...)}`
 *    (lib/img-fallback.ts) with the Worker's /img URL, which serves Steam's
 *    JPEG when the AVIF is not minted yet (the bucket answers 404) or the
 *    browser cannot decode AVIF. Both fire the same `error` event.
 *  - Under Tauri everything goes through /img/*: the released apps' CSP does
 *    not allow the media host, and the fallback helpers return null there.
 *  - The social card stays on `d2`, which is always JPEG.
 *
 * worker/routes/img.ts has the variants; shared/img-keys.ts the R2 key scheme,
 * which the cron, the Worker and this file must agree on byte for byte.
 *
 * EVERY <img> SHOWING THESE URLS SETS referrerpolicy="no-referrer". The zone
 * has Cloudflare Hotlink Protection on, which 403s `/img/*` at the edge -
 * before the Worker ever runs - whenever the Referer names another site, and
 * allows a request with no Referer at all. The packaged apps load from
 * http://tauri.localhost (Windows, Android) or tauri://localhost, and the
 * webview sends that origin as the Referer: every image in the 2.0.0 apps went
 * blank that way. `npm run dev` hit the same 403 through its proxy. On the web
 * these requests are same-site and would pass either way, so the attribute
 * costs nothing there. src/lib/images.test.ts fails on an <img> without it;
 * docs/SECURITY_SETUP.md section 10 has the measurements.
 */
import { AVIF_VARIANTS, avifKey } from "../../shared/img-keys";
import { parseSteamImage, sourceKey } from "../../shared/steam-image";
import { isTauri } from "./external-open";
import { API_ORIGIN as IMG_ORIGIN, MEDIA_ORIGIN } from "./site";

/**
 * `s` 230 px and `d` 460 px are negotiated (AVIF or JPEG). `t` and `d2` are
 * the original JPEG and stay for released apps, older pages and social cards.
 */
export type ImageVariant = "s" | "d" | "t" | "d2";

/**
 * Rewrite a Steam header URL to the Worker's /img proxy. Returns the input
 * unchanged if it does not match the expected shape, so an unexpected URL
 * still renders rather than 404-ing through the proxy.
 */
function proxied(url: string, variant: ImageVariant): string {
  const src = parseSteamImage(url);
  return src ? `${IMG_ORIGIN}/img/${variant}/${sourceKey(src)}` : url;
}

/** The minted AVIF on the media host (web), or the /img route (Tauri). */
function primary(url: string, variant: "s" | "d"): string {
  const src = parseSteamImage(url);
  if (!src || isTauri()) return proxied(url, variant);
  return `${MEDIA_ORIGIN}/${avifKey(AVIF_VARIANTS[variant], src)}`;
}

/** What imgFallback swaps in: null wherever `primary` is already /img. */
function fallback(url: string, variant: "s" | "d"): string | null {
  if (!parseSteamImage(url) || isTauri()) return null;
  return proxied(url, variant);
}

/**
 * Thumbnail for the tables, cards and command palette: 230 px wide, the same
 * aspect as the header (the old `t` variant served Steam's 184x69 capsule on
 * half the catalogue and the full header on the rest, so the two halves
 * cropped differently).
 */
export function headerToCapsule(url: string): string {
  return primary(url, "s");
}

/** `{@attach imgFallback(thumbFallback(url))}` beside `src={headerToCapsule(url)}`. */
export function thumbFallback(url: string): string | null {
  return fallback(url, "s");
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
  return primary(url, "d");
}

/** `{@attach imgFallback(heroFallback(url))}` beside `src={heroImage(url)}`. */
export function heroFallback(url: string): string | null {
  return fallback(url, "d");
}
