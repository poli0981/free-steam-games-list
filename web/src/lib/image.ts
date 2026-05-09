/**
 * Image URL helpers — Steam header → capsule transform + WebP proxy.
 *
 * Steam serves header.jpg (~460×215, ~50 KB) and capsule_184x69.jpg (~10 KB)
 * from the same path, so we can swap the filename to save bandwidth on
 * thumbnails. For larger views we route through images.weserv.nl, which
 * transcodes to WebP on the fly.
 */

export function headerToCapsule(url: string): string {
  if (!url || !url.includes("header.jpg")) return url;
  return url.replace("header.jpg", "capsule_184x69.jpg");
}

export function webpProxyUrl(url: string, width?: number): string {
  if (!url) return url;
  const stripped = url.replace(/^https?:\/\//, "");
  const params = new URLSearchParams({ url: stripped, output: "webp", q: "75" });
  if (width) params.set("w", String(width));
  return `https://images.weserv.nl/?${params.toString()}`;
}
