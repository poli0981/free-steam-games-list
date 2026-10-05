/**
 * /img/{variant}/{appid}[/{40-hex}]/{asset}.jpg — same-origin image proxy.
 *
 * Replaces the third-party images.weserv.nl hop that large images used to take,
 * so image traffic stays first-party and the privacy policy can say so.
 *
 * Two Steam CDN hosts serve this catalog, not one: shared.akamai.steamstatic.com
 * (~80% of records) and shared.fastly.steamstatic.com (~20%). Any allowlist,
 * CSP or cache rule that names only akamai silently misses a fifth of the
 * images.
 *
 * Variants:
 *
 *   s, d   Negotiated. A client whose Accept names image/avif gets the AVIF
 *          copy the cron minted into R2 (lib/img-mint.ts, lib/img-store.ts):
 *          `s` is 230 px wide for thumbnails, `d` 460 px - the full width of
 *          every Steam header. Until that copy exists the original JPEG goes
 *          out as a PROVISIONAL answer: one day, no X-Img-Final, so neither
 *          the browser nor the service worker (vite.config.ts) keeps it once
 *          the AVIF lands. A client without AVIF gets the JPEG as its final
 *          answer. Every s/d response says `Vary: Accept`.
 *   t, d2  The original JPEG, always. `t` is what released apps and older
 *          pages ask for as a thumbnail (Steam's 184x69 capsule where one
 *          exists). `d2` is the social card: og:image and JSON-LD point at it,
 *          and a crawler that claims AVIF in Accept but cannot render it must
 *          never be handed one.
 *
 * The web app asks the bucket's custom domain for the minted AVIF first
 * (src/lib/image.ts) - served from Cloudflare's cache, which a Worker can
 * never be - and comes here only when that fails: not minted yet, or no AVIF
 * decoder. The packaged apps come here for everything.
 *
 * THIS PATH NEVER TRANSFORMS. Minting runs only in the cron, from the
 * published dataset, so no request - an unknown appid, a forged ?t=, a HEAD -
 * can create a billed transformation or an R2 object.
 *
 * /img/gh/{u|in}/{id} is the second thing this file serves: GitHub avatars for
 * the Activity page. They used to be rendered straight from
 * avatars.githubusercontent.com, which no CSP in this repo allowed, so every
 * avatar on /activity was blocked outright. Widening img-src was the wrong fix
 * — it would put a third-party host back in the page and leak every visitor's
 * IP to GitHub. Proxying keeps img-src at 'self' and works in the Tauri builds,
 * whose CSP already allows free-steam-games.win, unchanged.
 */
import type { SteamSource } from "../../shared/steam-image";
import { sourceKey } from "../../shared/steam-image";
import { jsonError, SECURITY_HEADERS } from "../lib/http";
import { AVIF_VARIANTS, avifKey, mediaBucket, SOURCE_HOSTS, steamUrl, variantTag, type AvifVariant } from "../lib/img-store";

/** The legacy variants: the original JPEG, never negotiated. */
const PASSTHROUGH = new Set(["t", "d2"]);

/** `<appid>/<asset>.jpg` or `<appid>/<40-hex>/<asset>.jpg`. Anchored; the
 *  asset name is restricted so this cannot address arbitrary Steam paths. */
const PATH_RE = /^(\d{1,8})(?:\/([0-9a-f]{40}))?\/([a-z0-9_]{1,64}\.jpg)$/;

/** The only origin the avatar branch will fetch from. */
const AVATAR_HOST = "avatars.githubusercontent.com";

/** `u/<id>` for a user, `in/<id>` for a GitHub App (the pipeline's own commits
 *  are authored by one, which is where `in/15368` comes from). Anchored, and
 *  the id is digits only, so this cannot address any other GitHub path. */
const AVATAR_RE = /^(u|in)\/(\d{1,12})$/;

/** Rendered at 28 CSS px, so 56 covers a 2x display. Fixed, not a parameter:
 *  a caller-chosen size is an unbounded set of cache keys. */
const AVATAR_PX = 56;

const YEAR = 31536000;
const MONTH = 2592000;
const DAY = 86400;

/**
 * How long this data centre remembers that R2 has no AVIF for a source: one
 * cron tick, the soonest a mint could add it. Without it every request for a
 * game the cron has not reached - the backfill, a new game, a changed `?t=` -
 * paid an R2 read to learn the same thing again.
 */
const MISS_TTL = 900;

/**
 * Marks an answer that will not change for this URL and this client, and is
 * therefore safe to keep. The service worker's CacheFirst rule caches only
 * responses that carry it - CacheFirst ignores Cache-Control, so without this
 * a provisional JPEG would be served for 30 days after the AVIF existed.
 */
const FINAL = { "X-Img-Final": "1" };

export async function handleImg(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(405, "method not allowed");
  }

  // Never a source for Cloudflare's URL transformations. With zone
  // Transformations on, /cdn-cgi/image/<options>/img/... is always allowed -
  // same-zone sources cannot be excluded - and /img/* proxies ANY Steam
  // appid, so anyone could bill transformations with arbitrary options,
  // outside IMG_TRANSFORM_MONTHLY_CAP. The site never transforms by URL (only
  // the cron does, through the Images binding, from Steam directly). The
  // service fetches sources with `Via: 1.1 image-resizing-proxy` (measured
  // with wrangler tail, 2026-10-02).
  if (/image-resizing/i.test(request.headers.get("Via") ?? "")) {
    return jsonError(403, "not a transformation source");
  }

  const rest = url.pathname.slice("/img/".length);
  const slash = rest.indexOf("/");
  if (slash < 0) return jsonError(404, "not found");

  const variant = rest.slice(0, slash);

  // Avatars are a different upstream with a different path shape, so they
  // branch out first. They keep the /img/ prefix on purpose: it is already in
  // run_worker_first and already matched by the service worker's CacheFirst
  // rule, so neither needed a change.
  if (variant === "gh") {
    return headOnly(request, await handleAvatar(rest.slice(slash + 1), url, ctx));
  }

  const avif = variant === "s" || variant === "d" ? AVIF_VARIANTS[variant] : undefined;
  if (!avif && !PASSTHROUGH.has(variant)) return jsonError(404, "unknown variant");

  const m = PATH_RE.exec(rest.slice(slash + 1));
  if (!m) return jsonError(404, "not found");
  const [, appid, hash, asset] = m;

  // The first ?t= only, digits only: anything else is not a Steam mtime and
  // must not fork a cache key.
  const stamp = url.searchParams.get("t");
  const src: SteamSource = {
    path: hash ? `${appid}/${hash}/${asset}` : `${appid}/${asset}`,
    stamp: stamp && /^\d{1,12}$/.test(stamp) ? stamp : null,
  };

  if (avif && acceptsAvif(request)) {
    const minted = await fromR2(env, ctx, url, avif, src, asset);
    if (minted) return headOnly(request, minted);
    return headOnly(request, await original(ctx, url, src, { thumb: false, final: false, negotiated: true }));
  }

  return headOnly(
    request,
    await original(ctx, url, src, { thumb: variant === "t", final: true, negotiated: Boolean(avif) }),
  );
}

/** Browsers add image/avif to their image Accept header only when they decode it. */
function acceptsAvif(request: Request): boolean {
  return /\bimage\/avif\b/i.test(request.headers.get("Accept") ?? "");
}

/**
 * The minted AVIF, from the edge cache or R2. null when there is none yet -
 * including when the bucket is not bound at all.
 */
async function fromR2(
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  variant: AvifVariant,
  src: SteamSource,
  asset: string,
): Promise<Response | null> {
  const cache = caches.default;
  // Normalised: the format, width and quality are in the key - the Cache API
  // ignores Vary, an old encoding must never be served for a new one, and
  // stray query parameters must not fork it.
  const id = `${variantTag(variant)}/${sourceKey(src)}`;
  const key = new Request(`${url.origin}/img/~avif/${id}`);
  const hit = await cache.match(key);
  if (hit) return withHeaders(hit, { Vary: "Accept" });

  const bucket = mediaBucket(env);
  if (!bucket) return null;
  const missKey = new Request(`${url.origin}/img/~avif-miss/${id}`);
  if (await cache.match(missKey)) return null;
  const object = await bucket.get(avifKey(variant, src));
  if (!object) {
    ctx.waitUntil(
      cache.put(missKey, new Response("", { headers: { "Cache-Control": `public, max-age=${MISS_TTL}` } })),
    );
    return null;
  }

  const res = new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": "image/avif",
      // The key carries Steam's ?t=, so a changed image is a different URL.
      "Cache-Control": `public, max-age=${YEAR}, immutable`,
      ETag: object.httpEtag,
      // "Save image as" would otherwise name AVIF bytes header.jpg.
      "Content-Disposition": `inline; filename="${asset.replace(/\.jpg$/, ".avif")}"`,
      ...FINAL,
      ...SECURITY_HEADERS,
    },
  });
  // Cached WITHOUT Vary (the Cache API ignores it; the key already says
  // AVIF); the copy that leaves here gets it.
  ctx.waitUntil(cache.put(key, res.clone()));
  return withHeaders(res, { Vary: "Accept" });
}

interface OriginalOptions {
  /** Prefer Steam's 184x69 capsule (legacy `t`). */
  thumb: boolean;
  /** Final for this client, rather than standing in for an AVIF not minted yet. */
  final: boolean;
  /** The URL is negotiated (s/d), so the answer must say Vary: Accept. */
  negotiated: boolean;
}

/** Steam's own JPEG, edge-cached once per (shape, source version). */
async function original(
  ctx: ExecutionContext,
  url: URL,
  src: SteamSource,
  opts: OriginalOptions,
): Promise<Response> {
  const cache = caches.default;
  const key = new Request(`${url.origin}/img/~jpeg/${opts.thumb ? "thumb" : "orig"}/${sourceKey(src)}`);
  const hit = await cache.match(key);
  if (hit) return finish(hit, opts);

  // Steam's own small capsule (~7 KB against ~34 KB) exists only on the
  // un-hashed asset paths, so it is tried only there - on a hashed path it
  // cost two guaranteed 404s per cache miss.
  const hashed = src.path.split("/").length === 3;
  const candidates =
    opts.thumb && !hashed && !src.path.endsWith("/capsule_184x69.jpg")
      ? [src.path.replace(/[^/]+\.jpg$/, "capsule_184x69.jpg"), src.path]
      : [src.path];

  let upstream: Response | undefined;
  outer: for (const candidate of candidates) {
    for (const host of SOURCE_HOSTS) {
      const attempt = await fetch(steamUrl(host, candidate, src.stamp), {
        cf: { cacheTtl: MONTH, cacheEverything: true },
      });
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
      // The edge copy's lifetime. What the client is told is set in finish().
      "Cache-Control": `public, max-age=${MONTH}`,
      ...SECURITY_HEADERS,
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return finish(res, opts);
}

/**
 * Client-facing headers for the JPEG. One edge copy serves both cases: final
 * (a month, immutable - Steam's ?t= is an asset mtime, so a changed image
 * changes the URL) and provisional (a day, and nothing that lets the service
 * worker keep it).
 */
function finish(res: Response, opts: OriginalOptions): Response {
  const out = withHeaders(res, {
    "Cache-Control": opts.final ? `public, max-age=${MONTH}, immutable` : `public, max-age=${DAY}`,
    ...(opts.negotiated ? { Vary: "Accept" } : {}),
  });
  if (opts.final) out.headers.set("X-Img-Final", "1");
  else out.headers.delete("X-Img-Final");
  return out;
}

/** A copy with mutable headers: responses from the cache or fetch() are not. */
function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

/** HEAD answers the GET's status and headers with no body. */
function headOnly(request: Request, res: Response): Response {
  return request.method === "HEAD" ? new Response(null, res) : res;
}

async function handleAvatar(
  rest: string,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  const m = AVATAR_RE.exec(rest);
  if (!m) return jsonError(404, "not found");
  const [, kind, id] = m;

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = await fetch(
    `https://${AVATAR_HOST}/${kind}/${id}?v=4&s=${AVATAR_PX}`,
    { cf: { cacheTtl: 604800, cacheEverything: true } },
  );
  // A deleted account or app 404s upstream. Say so rather than caching a
  // placeholder for a week; the Activity page already renders a fallback icon
  // when the avatar will not load.
  if (!upstream.ok) return jsonError(404, "not found");

  const res = new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
      // An avatar can change under a stable URL, so this is a week rather than
      // the immutable year minted Steam art gets.
      "Cache-Control": "public, max-age=604800",
      ...FINAL,
      ...SECURITY_HEADERS,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
