/**
 * /img/{variant}/{appid}[/{40-hex}]/{asset}.jpg — same-origin image proxy.
 *
 * Replaces the third-party images.weserv.nl hop that large images used to take,
 * so image traffic stays first-party and the privacy policy can say so.
 *
 * Two Steam CDN hosts serve this catalog, not one: shared.akamai.steamstatic.com
 * (~1,927 records) and shared.fastly.steamstatic.com (~1,496, i.e. 44%). Any
 * allowlist, CSP or cache rule that names only akamai silently misses almost
 * half the images.
 */
import { jsonError, SECURITY_HEADERS } from "../lib/http";

/** The ONLY origins this proxy will fetch from. Anything else is SSRF. */
const SOURCE_HOSTS = [
  "shared.akamai.steamstatic.com",
  "shared.fastly.steamstatic.com",
] as const;

/** variant -> target width. Kept tiny and closed: an open width parameter is
 *  an open cheque once transformations are switched on, because each distinct
 *  option set bills as its own "unique transformation". */
const VARIANTS: Record<string, number> = { t: 184, d: 460, d2: 920 };

/** `<appid>/<asset>.jpg` or `<appid>/<40-hex>/<asset>.jpg`. Anchored; the
 *  asset name is restricted so this cannot address arbitrary Steam paths. */
const PATH_RE = /^(\d{1,8})(?:\/([0-9a-f]{40}))?\/([a-z0-9_]{1,64}\.jpg)$/;

export async function handleImg(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(405, "method not allowed");
  }

  const rest = url.pathname.slice("/img/".length);
  const slash = rest.indexOf("/");
  if (slash < 0) return jsonError(404, "not found");

  const variant = rest.slice(0, slash);
  const width = VARIANTS[variant];
  if (!width) return jsonError(404, "unknown variant");

  const m = PATH_RE.exec(rest.slice(slash + 1));
  if (!m) return jsonError(404, "not found");
  const [, appid, hash, asset] = m;

  const suffix = hash ? `${appid}/${hash}/${asset}` : `${appid}/${asset}`;
  const stamp = url.searchParams.get("t");
  const qs = stamp && /^\d{1,12}$/.test(stamp) ? `?t=${stamp}` : "";

  // Serve from the edge cache before touching Steam or a transformation.
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Transformations are billed separately from Workers Paid and Cloudflare has
  // no spend cap, so they stay OFF until real /img/* volume is known. When
  // enabling: land the appid allowlist FIRST, and pin `format` to exactly one
  // value — deriving it from Accept doubles the unique-transformation count.
  // String(): `wrangler types` narrows this to the literal "false" from
  // wrangler.jsonc, but the value is overridable per-environment in the
  // dashboard, so the literal type is a lie about runtime.
  const transform = String(env.IMG_TRANSFORM) === "true";
  const cf = transform
    ? { image: { width, fit: "scale-down" as const, format: "webp" as const, quality: 75 },
        cacheTtl: 2592000, cacheEverything: true }
    : { cacheTtl: 2592000, cacheEverything: true };

  // Thumbnails: prefer Steam's own small capsule (~10 KB) over the full header
  // (~34 KB). It does not exist for the hashed asset paths — roughly half the
  // catalog — so it is an attempt, not a rewrite, and we fall back to the
  // requested asset. The extra upstream request only happens on a cache miss.
  const candidates =
    variant === "t" && asset !== "capsule_184x69.jpg"
      ? [suffix.replace(/[^/]+\.jpg$/, "capsule_184x69.jpg"), suffix]
      : [suffix];

  let upstream: Response | undefined;
  outer: for (const candidate of candidates) {
    for (const host of SOURCE_HOSTS) {
      const attempt = await fetch(
        `https://${host}/store_item_assets/steam/apps/${candidate}${qs}`,
        { cf },
      );
      if (attempt.ok) {
        upstream = attempt;
        break outer;
      }
    }
  }
  if (!upstream) return jsonError(404, "not found");

  const res = new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
      // Steam's ?t= is an asset mtime, so a changed image changes the URL.
      "Cache-Control": "public, max-age=2592000, immutable",
      ...SECURITY_HEADERS,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
