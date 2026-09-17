/**
 * /api/updates/desktop — the desktop app's update feed.
 *
 * tauri.conf.json used to point the updater at
 * github.com/…/releases/latest/download/latest.json. That URL follows GitHub's
 * single "latest" release, and this repository publishes three kinds of
 * release on one page - the dataset (`v*`), Android (`android-v*`) and desktop
 * (`desktop-v*`). "Latest" was therefore usually NOT a desktop release, the
 * file 404ed, and the updater could never have found an update.
 *
 * This route answers with the `latest.json` of the newest published
 * `desktop-vX.Y.Z` release instead:
 *
 *   - It reads the repository's releases.atom feed, not the REST API. The feed
 *     is not rate-limited the way anonymous API calls are - a Worker egresses
 *     from shared Cloudflare addresses (see routes/activity.ts) - and it never
 *     lists drafts, so an unpublished build is never offered.
 *   - Like /api/activity it is public and unauthenticated, and it must never
 *     use the GitHub App installation token, which is a repository-write
 *     credential.
 *   - Integrity does not rest on this route. The updater verifies every
 *     download against the minisign public key compiled into the app; this
 *     route additionally refuses any artefact URL outside this repository's own
 *     release downloads.
 *   - 204 No Content is the Tauri updater's "no update available". Anything
 *     unusable - no desktop release yet, a malformed latest.json, GitHub
 *     unreachable - is a 204, never an error the app would surface.
 */
import { jsonError, SECURITY_HEADERS } from "../lib/http";

const REPO = "poli0981/free-steam-games-list";
const FEED = `https://github.com/${REPO}/releases.atom`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const DESKTOP_TAG = /^desktop-v(\d+)\.(\d+)\.(\d+)$/;
const UA = "free-steam-games-list-worker";

/** How long an answer (including "no update") is reused at the edge. */
const EDGE_TTL = 300;
/** A failed lookup is retried sooner than a successful one is refreshed. */
const FAILURE_TTL = 60;

interface PlatformEntry {
  signature: string;
  url: string;
}

interface LatestJson {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, PlatformEntry>;
}

/** The newest desktop tag named in the feed, by version rather than feed order. */
export function newestDesktopTag(atom: string): string | null {
  let best: { tag: string; v: [number, number, number] } | null = null;
  for (const m of atom.matchAll(/\/releases\/tag\/([^"'<>\s]+)/g)) {
    const tag = decodeURIComponent(m[1]);
    const parts = DESKTOP_TAG.exec(tag);
    if (!parts) continue;
    const v: [number, number, number] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    if (!best || v[0] > best.v[0] || (v[0] === best.v[0] && (v[1] > best.v[1] || (v[1] === best.v[1] && v[2] > best.v[2])))) {
      best = { tag, v };
    }
  }
  return best?.tag ?? null;
}

/** latest.json, validated, or null. */
export function validLatest(raw: unknown, tag: string): LatestJson | null {
  if (typeof raw !== "object" || raw === null) return null;
  const doc = raw as Record<string, unknown>;
  const version = typeof doc.version === "string" ? doc.version.replace(/^v/, "") : "";
  // The file must describe the release it was published with.
  if (`desktop-v${version}` !== tag) return null;
  const platforms = doc.platforms;
  if (typeof platforms !== "object" || platforms === null) return null;
  const entries = Object.entries(platforms as Record<string, unknown>);
  if (entries.length === 0) return null;
  for (const [, entry] of entries) {
    if (typeof entry !== "object" || entry === null) return null;
    const { signature, url } = entry as Record<string, unknown>;
    if (typeof signature !== "string" || !signature) return null;
    if (typeof url !== "string" || !url.startsWith(`${DOWNLOAD_PREFIX}${tag}/`)) return null;
  }
  return {
    version: doc.version as string,
    ...(typeof doc.notes === "string" ? { notes: doc.notes.slice(0, 4000) } : {}),
    ...(typeof doc.pub_date === "string" ? { pub_date: doc.pub_date } : {}),
    platforms: platforms as Record<string, PlatformEntry>,
  };
}

function noUpdate(ttl: number): Response {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": `public, max-age=${ttl}`, ...SECURITY_HEADERS },
  });
}

async function lookup(): Promise<Response> {
  let feed: Response;
  try {
    feed = await fetch(FEED, { headers: { Accept: "application/atom+xml", "User-Agent": UA } });
  } catch (err) {
    console.warn("updates: feed unreachable", err instanceof Error ? err.message : String(err));
    return noUpdate(FAILURE_TTL);
  }
  if (!feed.ok) {
    console.warn("updates: feed error", { status: feed.status });
    return noUpdate(FAILURE_TTL);
  }

  const tag = newestDesktopTag(await feed.text());
  if (!tag) return noUpdate(EDGE_TTL);

  let asset: Response;
  try {
    asset = await fetch(`${DOWNLOAD_PREFIX}${tag}/latest.json`, { headers: { "User-Agent": UA } });
  } catch {
    return noUpdate(FAILURE_TTL);
  }
  if (!asset.ok) {
    console.warn("updates: latest.json missing", { tag, status: asset.status });
    return noUpdate(FAILURE_TTL);
  }

  let parsed: unknown;
  try {
    parsed = await asset.json();
  } catch {
    return noUpdate(FAILURE_TTL);
  }
  const latest = validLatest(parsed, tag);
  if (!latest) {
    console.warn("updates: latest.json rejected", { tag });
    return noUpdate(FAILURE_TTL);
  }

  return new Response(JSON.stringify(latest), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${EDGE_TTL}`,
      ...SECURITY_HEADERS,
    },
  });
}

export async function handleDesktopUpdates(
  request: Request,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(405, "method not allowed");
  }
  // Keyed on the path alone: the updater may append query parameters, and
  // each distinct URL must not become its own upstream lookup.
  const key = new Request(`${url.origin}/api/updates/desktop`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;

  const res = await lookup();
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
