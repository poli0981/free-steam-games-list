/**
 * /api/activity — same-origin proxy for the repository's recent commits.
 *
 * The Activity page used to call api.github.com straight from the browser. That
 * was the last third-party request the public app made, and it cost three
 * separate things:
 *
 *   1. Every visitor's IP reached GitHub, so the privacy policy had to carve
 *      out an exception for this one page.
 *   2. `connect-src` had to list https://api.github.com, weakening the CSP for
 *      the whole site because of one route.
 *   3. The avatar URLs in the response pointed at
 *      avatars.githubusercontent.com, which `img-src` never allowed — so the
 *      avatars were blocked in the browser AND in both Tauri builds.
 *
 * Proxying fixes all three. Avatar URLs are rewritten here to /img/gh/... so
 * the client never even sees a GitHub hostname.
 *
 * Rate limiting is why this is edge-cached rather than passed through.
 * Unauthenticated GitHub allows 60 requests/hour per IP; a Worker egresses from
 * a shared Cloudflare address, so a pass-through would exhaust that almost
 * immediately under any real traffic. EDGE_TTL caps upstream traffic at
 * 3600/EDGE_TTL requests an hour no matter how many visitors arrive. It is NOT
 * authenticated on purpose: the GitHub App installation token is a
 * repository-write credential and has no business on a public, unauthenticated
 * route.
 */
import { jsonError, SECURITY_HEADERS } from "../lib/http";

const REPO_OWNER = "poli0981";
const REPO_NAME = "free-steam-games-list";
const DEFAULT_BRANCH = "main";

/** 5 minutes → at most 12 upstream calls an hour, against a budget of 60. */
const EDGE_TTL = 300;

/** Matches the per_page the page used to request directly. */
const PER_PAGE = 80;

/** What GitHub sends back, narrowed to the fields that are actually consumed. */
interface GhCommit {
  sha?: unknown;
  html_url?: unknown;
  commit?: {
    author?: { name?: unknown; date?: unknown };
    message?: unknown;
    verification?: { verified?: unknown; reason?: unknown };
  };
  author?: { login?: unknown; avatar_url?: unknown } | null;
}

/** What this route sends to the client. */
interface ActivityCommit {
  sha: string;
  html_url: string;
  subject: string;
  author_date: string;
  author_name: string;
  login: string | null;
  avatar: string | null;
  verified: boolean;
  reason: string;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/**
 * Rewrite a GitHub avatar URL to this site's own proxy.
 *
 * Only the two shapes GitHub actually emits are accepted — `u/<id>` for a user
 * and `in/<id>` for a GitHub App. Anything else returns null and the page
 * renders its fallback icon, rather than being passed through to a host the CSP
 * would block anyway.
 */
function proxyAvatar(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^https:\/\/avatars\.githubusercontent\.com\/(u|in)\/(\d{1,12})\b/.exec(v);
  return m ? `/img/gh/${m[1]}/${m[2]}` : null;
}

/**
 * Two deliberate omissions, both about not re-publishing addresses.
 *
 * `commit.author.email` is dropped: GitHub returns it for every commit, the
 * page never used it, and forwarding it would make this route a bulk
 * email-harvesting endpoint for everyone who has ever contributed.
 *
 * Only the SUBJECT line of the message is forwarded, not the body. The page
 * renders nothing else, and the bodies in this repository carry Co-Authored-By
 * trailers with real addresses in them - verified against live output, which is
 * how this was caught. Sending the full message made the response ~4x larger
 * and re-broadcast those addresses from a publicly edge-cached endpoint.
 */
function shape(c: GhCommit): ActivityCommit | null {
  const sha = str(c.sha, 40);
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;
  const ver = c.commit?.verification;
  return {
    sha,
    html_url: str(c.html_url, 300),
    subject: str(c.commit?.message, 2000).split("\n")[0].slice(0, 300),
    author_date: str(c.commit?.author?.date, 40),
    author_name: str(c.commit?.author?.name, 200),
    login: typeof c.author?.login === "string" ? c.author.login.slice(0, 100) : null,
    avatar: proxyAvatar(c.author?.avatar_url),
    verified: ver?.verified === true,
    reason: str(ver?.reason, 60) || "unsigned",
  };
}

export async function handleActivity(
  request: Request,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(405, "method not allowed");
  }

  // Cache on the path alone. The route takes no parameters, so keying on the
  // full URL would let `?x=1` mint an unbounded number of cache entries and
  // walk straight past the rate-limit protection above.
  const cacheKey = new Request(`${url.origin}/api/activity`, { method: "GET" });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits` +
        `?per_page=${PER_PAGE}&sha=${DEFAULT_BRANCH}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          // GitHub rejects API requests with no User-Agent.
          "User-Agent": `${REPO_OWNER}-${REPO_NAME}-worker`,
        },
        cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
      },
    );
  } catch (err) {
    console.warn("activity: upstream unreachable", err instanceof Error ? err.message : String(err));
    return jsonError(502, "activity upstream unreachable");
  }

  if (!upstream.ok) {
    // 403 here is almost always the anonymous rate limit. Log the status so it
    // is diagnosable from `wrangler tail`, but do not pass GitHub's body
    // through to the client.
    console.warn("activity: upstream error", { status: upstream.status });
    return jsonError(502, "activity upstream error");
  }

  let raw: unknown;
  try {
    raw = await upstream.json();
  } catch {
    return jsonError(502, "activity upstream sent invalid JSON");
  }
  if (!Array.isArray(raw)) return jsonError(502, "activity upstream sent unexpected shape");

  const commits = raw
    .map((c) => shape(c as GhCommit))
    .filter((c): c is ActivityCommit => c !== null);

  const res = new Response(JSON.stringify({ commits }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=60, stale-while-revalidate=${EDGE_TTL}`,
      "CDN-Cache-Control": `public, max-age=${EDGE_TTL}`,
      // `*`, for the same reason /api/data/* carries it: the Tauri builds run on
      // tauri://localhost and read this response cross-origin, so without it
      // the Activity page is blank in both packaged apps. Safe here because the
      // body is the public commit list of a public repository — GitHub already
      // serves it to every origin — and no credentials ride on the request.
      // This must NEVER be copied onto /api/admin/* or /api/ingest/*.
      "Access-Control-Allow-Origin": "*",
      ...SECURITY_HEADERS,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
