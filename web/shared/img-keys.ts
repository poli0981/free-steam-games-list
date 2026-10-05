/**
 * Names of the AVIF copies of Steam header art - the ONE definition shared by
 * the cron that writes them to R2 (worker/lib/img-mint.ts), the /img route
 * that reads them through the Worker (worker/routes/img.ts) and the web app,
 * which asks the R2 custom domain for them directly (src/lib/image.ts). Three
 * places that must agree byte for byte on a key, so it lives here.
 *
 * The key carries everything that determines the bytes - the prefix (the
 * format), the width AND quality, the source path and Steam's `?t=` - so a
 * changed image or a changed setting is a NEW key, never an overwrite, and
 * nothing ever needs invalidating: not R2, not the edge, not a browser that
 * cached the old one for a year. Changing one variant's quality re-mints only
 * that variant (~5,600 transformations); a new format needs a new prefix.
 *
 * v1 (2026-10-02, first production batch) had the quality only in the prefix,
 * and `d` at q60 measured too soft for a hero the browser enlarges up to 3x:
 * SSIM 0.960 against Steam's JPEG, fine stripes and texture visibly smoothed.
 */
import type { SteamSource } from "./steam-image";

export const IMG_PREFIX = "img/v2/";

export interface AvifVariant {
  /** Output width. Every Steam header is 460x215, so `d` is full size. */
  width: number;
  /** AVIF quality, on Cloudflare's scale - which runs well below libavif's:
   *  Cloudflare's q60 at 460 px measured SSIM 0.960 (10.9 KB median on the ten
   *  most-played games, against 40 KB JPEGs) where Pillow's q55 gave 0.978. */
  quality: number;
}

/**
 * Variant letter -> AVIF parameters. `s` is the thumbnail (CSS boxes 52-90 px
 * wide, so 230 covers 2.5x), `d` the detail hero. A closed table on purpose:
 * each distinct option set is its own billed transformation.
 */
export const AVIF_VARIANTS: Readonly<Record<"s" | "d", AvifVariant>> = {
  // Shown at 52-90 CSS px, i.e. downscaled: q55 measured SSIM 0.952, 3.4 KB.
  s: { width: 230, quality: 55 },
  // The hero, which the browser ENLARGES to up to 768 CSS px: q80 measured
  // SSIM 0.979, 16.8 KB median.
  d: { width: 460, quality: 80 },
};

/** `img/v2/<width>q<quality>/<appid>[/<40-hex>]/<asset>@<t>.avif` (`@0` without `?t=`). */
export function avifKey(variant: AvifVariant, src: SteamSource): string {
  return `${IMG_PREFIX}${variantTag(variant)}/${src.path.replace(/\.jpg$/, "")}@${src.stamp ?? "0"}.avif`;
}

/** `460q80`: the part of every key - R2 and edge cache - that names the encoding. */
export function variantTag(variant: AvifVariant): string {
  return `${variant.width}q${variant.quality}`;
}
