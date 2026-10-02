/**
 * AVIF copies of Steam header art in R2 (bucket f2p-media, binding MEDIA).
 *
 * Written ONLY by the cron (lib/img-mint.ts); read by the /img route
 * (routes/img.ts). Nothing a visitor sends can create one.
 *
 * The key carries everything that determines the bytes - this prefix, the
 * width, the source path and Steam's `?t=` - so a changed image is a NEW key,
 * never an overwrite, and nothing ever needs invalidating. `v1` also pins the
 * format and the quality below: changing either means a new prefix, which
 * means re-minting every image (~11k unique transformations).
 */
import type { SteamSource } from "../../shared/steam-image";

export const IMG_PREFIX = "img/v1/";

export interface AvifVariant {
  /** Output width. Every Steam header is 460x215, so `d` is full size. */
  width: number;
  /** AVIF quality. Measured on 24 headers (Pillow/libavif): q55 at 230 px is
   *  ~3.6 KB, q60 at 460 px ~9 KB, against a ~36 KB JPEG. */
  quality: number;
}

/**
 * Variant letter -> AVIF parameters. `s` is the thumbnail (CSS boxes 52-90 px
 * wide, so 230 covers 2.5x), `d` the detail hero. A closed table on purpose:
 * each distinct option set is its own billed transformation.
 */
export const AVIF_VARIANTS: Readonly<Record<string, AvifVariant>> = {
  s: { width: 230, quality: 55 },
  d: { width: 460, quality: 60 },
};

/** The ONLY origins anything here fetches art from. Anything else is SSRF. */
export const SOURCE_HOSTS = [
  "shared.akamai.steamstatic.com",
  "shared.fastly.steamstatic.com",
] as const;

/** Steam URL of one candidate path, on one host. */
export function steamUrl(host: string, path: string, stamp: string | null): string {
  return `https://${host}/store_item_assets/steam/apps/${path}${stamp ? `?t=${stamp}` : ""}`;
}

/** `img/v1/<width>/<appid>[/<40-hex>]/<asset>@<t>.avif` (`@0` when there is no `?t=`). */
export function avifKey(width: number, src: SteamSource): string {
  return `${IMG_PREFIX}${width}/${src.path.replace(/\.jpg$/, "")}@${src.stamp ?? "0"}.avif`;
}

/**
 * The bindings, read as optional. wrangler.jsonc declares both, but a missing
 * bucket or Images binding must degrade to the plain proxy rather than throw,
 * so the order in which the dashboard and a deploy change never matters.
 */
export function mediaBucket(env: Env): R2Bucket | undefined {
  return (env as { MEDIA?: R2Bucket }).MEDIA;
}

export function imagesBinding(env: Env): ImagesBinding | undefined {
  return (env as { IMAGES?: ImagesBinding }).IMAGES;
}
