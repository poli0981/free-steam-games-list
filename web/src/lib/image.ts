/**
 * Image URL helpers — Steam header → capsule transform + WebP proxy.
 *
 * Steam serves header.jpg (~460×215, ~50 KB) and capsule_184x69.jpg (~10 KB)
 * from the same path, so we can swap the filename to save bandwidth on
 * thumbnails. For larger views we route through images.weserv.nl, which
 * transcodes to WebP on the fly.
 */
import { isTauri } from "./external-open";

export function headerToCapsule(url: string): string {
  if (!url || !url.includes("header.jpg")) return url;
  return url.replace("header.jpg", "capsule_184x69.jpg");
}

function webpProxyUrl(url: string, width?: number): string {
  if (!url) return url;
  const stripped = url.replace(/^https?:\/\//, "");
  const params = new URLSearchParams({ url: stripped, output: "webp", q: "75" });
  if (width) params.set("w", String(width));
  return `https://images.weserv.nl/?${params.toString()}`;
}

/**
 * WebP-via-weserv for LARGE images only (detail drawer header, ~50 KB →
 * ~20 KB). Thumbnails stay on the direct Steam capsule URLs: they're already
 * ~10 KB, SW-cached, and putting a third-party proxy in the hottest render
 * path isn't worth ~5 KB/image (weserv downtime would degrade the whole
 * table). If thumbnails ever get proxied, do it behind a Settings toggle.
 *
 * Desktop (Tauri) always gets the direct URL — the bundled app shouldn't
 * leak browsing signals to a third-party CDN, and offline-first matters
 * more there. Callers should pair this with an onError fallback to the
 * original URL for weserv outages.
 */
export function preferWebp(url: string, width?: number): string {
  if (!url || isTauri()) return url;
  return webpProxyUrl(url, width);
}
