/**
 * AVIF copies of Steam header art in R2 (bucket f2p-media, binding MEDIA).
 *
 * Written ONLY by the cron (lib/img-mint.ts); read by the /img route
 * (routes/img.ts) and, on the web, straight from the bucket's custom domain
 * (media.free-steam-games.win) through Cloudflare's cache. Nothing a visitor
 * sends can create one. The key scheme lives in shared/img-keys.ts, because
 * the web app has to build the same keys.
 */
export { AVIF_VARIANTS, IMG_PREFIX, avifKey, variantTag, type AvifVariant } from "../../shared/img-keys";

/** The ONLY origins anything here fetches art from. Anything else is SSRF. */
export const SOURCE_HOSTS = [
  "shared.akamai.steamstatic.com",
  "shared.fastly.steamstatic.com",
] as const;

/** Steam URL of one candidate path, on one host. */
export function steamUrl(host: string, path: string, stamp: string | null): string {
  return `https://${host}/store_item_assets/steam/apps/${path}${stamp ? `?t=${stamp}` : ""}`;
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
