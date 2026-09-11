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

function isAllowed(path: string): boolean {
  if (path.includes("..") || path.includes("//")) return false;
  return ALLOWED.some((re) => re.test(path));
}

export async function handleData(request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(405, "method not allowed");
  }

  const path = url.pathname.slice("/api/data/".length);
  if (!isAllowed(path)) return jsonError(404, "not found");

  // index.json is the cache-invalidation signal for the whole client cache
  // (useGames keys IndexedDB on last_updated), so it must never be served
  // stale from a browser cache — but at ~170 bytes it is cheap to revalidate.
  // The shards are content that only changes when index.json says so.
  const isIndex = path === "data/index.json";
  const edgeTtl = isIndex ? 30 : 300;

  const upstream = await fetch(`${RAW_BASE}/${path}`, {
    cf: { cacheTtl: edgeTtl, cacheEverything: true },
    headers: { Accept: "application/json, text/plain, */*" },
  });

  if (!upstream.ok) {
    return jsonError(upstream.status === 404 ? 404 : 502, "upstream error");
  }

  const res = new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": path.endsWith(".json")
        ? "application/json; charset=utf-8"
        : "application/x-ndjson; charset=utf-8",
      "Cache-Control": isIndex
        ? "no-cache"
        : "public, max-age=300, stale-while-revalidate=600",
      "CDN-Cache-Control": `public, max-age=${edgeTtl}`,
      // `*`, deliberately and only here. This is the same public dataset
      // raw.githubusercontent.com serves to every origin with `*`, no
      // credentials ride on it, and the Tauri apps (tauri://localhost and
      // http://tauri.localhost) fetch it cross-origin — without this the
      // packaged apps cannot load the catalogue at all. Never copy this onto
      // /api/admin/* or /api/ingest/*.
      "Access-Control-Allow-Origin": "*",
      ...SECURITY_HEADERS,
    },
  });
  return res;
}
