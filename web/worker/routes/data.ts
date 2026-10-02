/**
 * /api/data/* — same-origin proxy for the dataset that lives in Git.
 *
 * Why proxy instead of shipping data/ inside dist/: the pipeline commits to
 * data/ roughly daily. If those files were build output, every data commit
 * would have to rebuild and redeploy the whole site, and if the build watch
 * paths ever excluded data/ the site would silently serve a frozen dataset
 * with no error anywhere. Proxying keeps the data cadence decoupled from
 * deploys, and the client still sees one origin.
 */
import { packBytes, sha256 } from "../../shared/data-pack";
import { jsonError, SECURITY_HEADERS } from "../lib/http";

const RAW_BASE =
  "https://raw.githubusercontent.com/poli0981/free-steam-games-list/main";

/**
 * Strict allowlist of the three paths the SPA actually fetches. Anchored, so
 * this cannot be walked into a general-purpose GitHub proxy.
 */
const ALLOWED = [
  /^data\/index\.json$/,
  /^data\/data_\d{3}\.jsonl$/,
  /^scripts\/removed_games\.jsonl$/,
];

const SHARD = /^data\/data_\d{3}\.jsonl$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * How long a hash mismatch is remembered before the upstream is asked again.
 * Every client that sees the new index retries, and without this each retry
 * would pull ~1.2 MB from GitHub during the window in which it is still
 * serving the old bytes.
 */
const MISMATCH_TTL = 20;

function isAllowed(path: string): boolean {
  if (path.includes("..") || path.includes("//")) return false;
  return ALLOWED.some((re) => re.test(path));
}

/**
 * `*`, deliberately and only on this route (and /api/activity). This is the
 * same public dataset raw.githubusercontent.com serves to every origin with
 * `*`, no credentials ride on it, and the Tauri apps (tauri://localhost and
 * http://tauri.localhost) fetch it cross-origin — without this the packaged
 * apps cannot load the catalogue at all. Never copy this onto /admin/api/* or
 * /api/ingest/*.
 */
const CORS = { "Access-Control-Allow-Origin": "*" };

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function handleData(
  request: Request,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(405, "method not allowed");
  }

  const path = url.pathname.slice("/api/data/".length);
  if (path.startsWith("p1/")) return handlePack(request, url, path.slice("p1/".length), ctx);
  if (!isAllowed(path)) return jsonError(404, "not found");

  const version = url.searchParams.get("v");
  if (version !== null && SHARD.test(path) && request.method === "GET") {
    return versionedShard(url, path, version, ctx);
  }

  // index.json is the cache-invalidation signal for the whole client cache, so
  // it must never be served stale from a browser cache — but at ~600 bytes it
  // is cheap to revalidate. Unversioned shards are what released apps request;
  // current clients ask for them by hash (below).
  const isIndex = path === "data/index.json";
  const edgeTtl = isIndex ? 30 : 300;

  const upstream = await fetch(`${RAW_BASE}/${path}`, {
    cf: { cacheTtl: edgeTtl, cacheEverything: true },
    headers: { Accept: "application/json, text/plain, */*" },
  });

  if (!upstream.ok) {
    return jsonError(upstream.status === 404 ? 404 : 502, "upstream error");
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": path.endsWith(".json")
        ? "application/json; charset=utf-8"
        : "application/x-ndjson; charset=utf-8",
      "Cache-Control": isIndex
        ? "no-cache"
        : "public, max-age=300, stale-while-revalidate=600",
      "CDN-Cache-Control": `public, max-age=${edgeTtl}`,
      ...CORS,
      ...SECURITY_HEADERS,
    },
  });
}

/**
 * A shard requested by the sha256 its index entry records.
 *
 * The response is served ONLY if its bytes hash to `v`, and is then cached for
 * a year: content that is addressed by its own hash can never be stale. That
 * closes the gap the unversioned path cannot, where the CDN (this edge's 300 s
 * cache, and raw.githubusercontent's own) hands out the previous shard next to
 * a freshly committed index.json, and a client stores that mismatched pair
 * under the new generation.
 *
 * On a mismatch the upstream has not caught up with the commit yet. That is a
 * 503 with Retry-After - never the wrong bytes - and the client keeps showing
 * the generation it already holds until a retry succeeds. The `?v=` sent
 * upstream does NOT bust raw.githubusercontent's cache (measured 2026-09-17: a
 * fresh query string was still an X-Cache HIT), so a mismatch lasts until that
 * CDN's ~5 minute max-age turns over. `cache: "no-store"` only keeps this
 * edge from adding its own layer on top.
 */
async function versionedShard(
  url: URL,
  path: string,
  version: string,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!SHA256_HEX.test(version)) return withCors(jsonError(400, "bad version"));

  const cache = caches.default;
  // Normalised: any other query parameter must not fork the cache entry.
  const key = new Request(`${url.origin}${url.pathname}?v=${version}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const body = await fetchVersioned(url.origin, path, version, ctx);
  if (body instanceof Response) return body;

  const res = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      ...CORS,
      ...SECURITY_HEADERS,
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/**
 * The bytes of `path` at `version`, or the error response to send instead.
 * Shared by the plain path above and the packed one below, and so is the
 * mismatch marker: whichever asks first spares GitHub the other's retry.
 */
async function fetchVersioned(
  origin: string,
  path: string,
  version: string,
  ctx: ExecutionContext,
): Promise<ArrayBuffer | Response> {
  if (!SHA256_HEX.test(version)) return withCors(jsonError(400, "bad version"));

  const cache = caches.default;
  const missKey = new Request(`${origin}/api/data/${path}?v=${version}&mismatch=1`);
  if (await cache.match(missKey)) return notYetUpdated();

  const upstream = await fetch(`${RAW_BASE}/${path}?v=${version}`, {
    cache: "no-store",
    headers: { Accept: "text/plain, */*" },
  });
  if (!upstream.ok) {
    return withCors(jsonError(upstream.status === 404 ? 404 : 502, "upstream error"));
  }

  const body = await upstream.arrayBuffer();
  if ((await sha256Hex(body)) !== version) {
    ctx.waitUntil(
      cache.put(
        missKey,
        new Response("mismatch", { headers: { "Cache-Control": `max-age=${MISMATCH_TTL}` } }),
      ),
    );
    return notYetUpdated();
  }
  return body;
}

/**
 * /api/data/p1/<name>.bin — the same files, packed (shared/data-pack.ts):
 * deflate-raw then AES-GCM under a key that is PUBLIC in this repository.
 * Obfuscation and compression, not secrecy: the readable dataset is the
 * repository, and the app unpacks to the exact committed bytes before the
 * same SHA-256 check as ever.
 *
 * `data_NNN.bin?v=<sha256>` is content-addressed exactly like the plain
 * versioned path (verified first, then immutable for a year). Without `v` -
 * the app's first visit during a 503 window, and removed_games.bin, which
 * the index does not hash - it is a five-minute copy the app cannot verify,
 * as on the plain path. `.bin`, not `.jsonl`: the zone's Compression Rule
 * matches `.jsonl`, and compressing a pack again only burns CPU.
 *
 * The plain paths above stay exactly as they are for the released apps
 * (1.4.5 and 2.0.x), which cannot unpack.
 */
async function handlePack(
  request: Request,
  url: URL,
  name: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const path = /^data_\d{3}\.bin$/.test(name)
    ? `data/${name.slice(0, -".bin".length)}.jsonl`
    : name === "removed_games.bin"
      ? "scripts/removed_games.jsonl"
      : null;
  if (!path) return withCors(jsonError(404, "not found"));

  const version = SHARD.test(path) ? url.searchParams.get("v") : null;
  if (version !== null && !SHA256_HEX.test(version)) return withCors(jsonError(400, "bad version"));

  const cache = caches.default;
  const key = new Request(`${url.origin}/api/data/p1/${name}${version ? `?v=${version}` : ""}`);
  const hit = await cache.match(key);
  if (hit) return headOnly(request, hit);

  let plain: Uint8Array;
  let digest: Uint8Array;
  if (version) {
    const body = await fetchVersioned(url.origin, path, version, ctx);
    if (body instanceof Response) return body;
    plain = new Uint8Array(body);
    digest = hexBytes(version);
  } else {
    const upstream = await fetch(`${RAW_BASE}/${path}`, {
      cf: { cacheTtl: 300, cacheEverything: true },
      headers: { Accept: "text/plain, */*" },
    });
    if (!upstream.ok) {
      return withCors(jsonError(upstream.status === 404 ? 404 : 502, "upstream error"));
    }
    plain = new Uint8Array(await upstream.arrayBuffer());
    digest = await sha256(plain);
  }

  const res = new Response(await packBytes(plain, digest), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": version ? "public, max-age=31536000, immutable" : "public, max-age=300",
      ...CORS,
      ...SECURITY_HEADERS,
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return headOnly(request, res);
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** HEAD answers the GET's status and headers with no body. */
function headOnly(request: Request, res: Response): Response {
  return request.method === "HEAD" ? new Response(null, res) : res;
}

function notYetUpdated(): Response {
  const res = withCors(jsonError(503, "upstream not yet updated"));
  res.headers.set("Retry-After", "30");
  return res;
}

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}
