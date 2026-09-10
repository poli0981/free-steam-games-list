/**
 * /api/ingest/* — the producer surface. The discovery pipeline POSTs candidate
 * games here; a human reviews them later under /admin.
 *
 * Authenticated by a Cloudflare Access SERVICE TOKEN, not a human login. The
 * caller is a GitHub Actions job, so there is no browser and no session.
 *
 * IMPORTANT: this surface can only ever PROPOSE. It writes rows with
 * status='pending' and cannot approve, commit, or otherwise reach the
 * repository. A stolen service token buys an attacker a filled review queue,
 * nothing more.
 */
import { jsonError, SECURITY_HEADERS } from "../lib/http";
import type { AccessIdentity } from "../lib/access";

/** Batch cap. Bounds both the D1 write budget and the Worker CPU per call. */
const MAX_BATCH = 100;
/** Rejects an oversized body before it is parsed. */
const MAX_BODY_BYTES = 512 * 1024;
/**
 * Per-candidate payload cap. Oversized payloads are DROPPED, never truncated:
 * truncating a serialized object mid-string produces invalid JSON, and every
 * later json_extract() and JSON.parse would fail on the row.
 */
const MAX_PAYLOAD_BYTES = 16 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

/**
 * Only the discovery pipeline's own service token may use this surface.
 *
 * verifyAccessJwt accepts a token bearing ANY configured AUD, so without this
 * an admin session would satisfy the ingest routes and — far worse — the
 * ingest token would satisfy the admin routes. Pinning the principal on both
 * sides is what stops the two credentials crossing.
 */
function isIngestPrincipal(who: AccessIdentity, env: Env): boolean {
  if (!who.isServiceToken) return false;
  // Comma-separated. Cloudflare does not document whether `common_name` on a
  // service-token JWT carries the token's friendly NAME or its Client ID, and
  // the two are indistinguishable from this side, so the pin accepts either
  // spelling of the same one token rather than guessing wrong and 404ing a
  // correctly-configured caller.
  return env.INGEST_SERVICE_PRINCIPAL.split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .includes(who.email);
}

interface CandidateIn {
  appid?: unknown;
  link?: unknown;
  name?: unknown;
  header_image?: unknown;
  release_date?: unknown;
  app_type?: unknown;
  is_free?: unknown;
  health_status?: unknown;
  reviews_raw?: unknown;
  reviews_pct?: unknown;
  current_players_raw?: unknown;
  current_players_num?: unknown;
  payload?: unknown;
}

interface Normalized {
  appid: string;
  link: string;
  name: string;
  header_image: string;
  release_date: string;
  app_type: string;
  is_free: number;
  health_status: string;
  reviews_raw: string;
  reviews_pct: number | null;
  current_players_raw: string;
  current_players_num: number | null;
  payload_json: string;
}

function str(v: unknown, max: number, fallback = ""): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

/** Returns the normalized row, or a reason string explaining the rejection. */
function normalize(c: CandidateIn): Normalized | string {
  const appid = typeof c.appid === "string" ? c.appid : String(c.appid ?? "");
  if (!/^\d{1,8}$/.test(appid)) return "appid must be 1-8 digits";

  // Anchored. The link is written into a repo file and later parsed by Python,
  // so it must be exactly the canonical store URL for this appid and nothing an
  // attacker can steer.
  const link = typeof c.link === "string" ? c.link : "";
  if (link !== "https://store.steampowered.com/app/" + appid + "/") {
    return "link must be the canonical store URL for appid";
  }

  let payloadJson = "{}";
  if (c.payload && typeof c.payload === "object") {
    const s = JSON.stringify(c.payload);
    if (s.length > MAX_PAYLOAD_BYTES) return "payload too large";
    payloadJson = s;
  }

  return {
    appid,
    link,
    // Publisher-controlled text that reaches an admin screen. Length-capped
    // here; escaping belongs to whatever renders it.
    name: str(c.name, 200),
    header_image: str(c.header_image, 500),
    release_date: str(c.release_date, 60),
    app_type: str(c.app_type, 30),
    // D1 rejects JS booleans, and the column is INTEGER CHECK (is_free IN (0,1)).
    is_free: c.is_free === true || c.is_free === 1 ? 1 : 0,
    health_status: str(c.health_status, 30, "unknown"),
    reviews_raw: str(c.reviews_raw, 60, "N/A"),
    reviews_pct: intOrNull(c.reviews_pct),
    current_players_raw: str(c.current_players_raw, 60, "N/A"),
    current_players_num: intOrNull(c.current_players_num),
    payload_json: payloadJson,
  };
}

export async function handleIngestApi(
  request: Request,
  url: URL,
  env: Env,
  who: AccessIdentity,
): Promise<Response> {
  if (!isIngestPrincipal(who, env)) {
    // The identity Access actually handed us. Without this the rejection is a
    // bare 404 indistinguishable from "no Access application covers the path",
    // and the only way to learn the real principal is to guess at it.
    console.warn("ingest: principal not allowed", {
      got: who.email,
      isServiceToken: who.isServiceToken,
      expected: env.INGEST_SERVICE_PRINCIPAL,
    });
    return jsonError(404, "not found");
  }

  const route = url.pathname.slice("/api/ingest/".length);

  // Cheap reachability probe. discover_new.py calls this BEFORE spending any
  // Steam requests, so a misconfigured token fails in a second rather than
  // after a twenty-minute sweep.
  if (route === "ping" && request.method === "GET") {
    return json({ ok: true, actor: who.email, isServiceToken: who.isServiceToken });
  }

  // Appids the producer need not fetch: already queued, or already decided.
  // Lets the sweep skip them before spending an appdetails call, and lets its
  // stop-rule count them as "known" — without that, yesterday's still-pending
  // candidates read as new and the rule never fires.
  if (route === "known" && request.method === "GET") {
    const [queued, decided] = await Promise.all([
      env.DB.prepare(
        "SELECT appid FROM ingest_queue WHERE status IN ('pending','deferred','approved','committed')",
      ).all<{ appid: string }>(),
      env.DB.prepare("SELECT appid FROM ingest_decisions").all<{ appid: string }>(),
    ]);
    const set = new Set<string>();
    for (const r of queued.results ?? []) set.add(r.appid);
    for (const r of decided.results ?? []) set.add(r.appid);
    return json({ count: set.size, appids: [...set] });
  }

  if (route === "candidates" && request.method === "POST") {
    const declared = Number(request.headers.get("Content-Length") ?? 0);
    if (declared > MAX_BODY_BYTES) return jsonError(413, "body too large");

    let body: { source?: unknown; candidates?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError(400, "invalid json");
    }

    const list = Array.isArray(body.candidates) ? body.candidates : null;
    if (!list) return jsonError(400, "candidates must be an array");
    if (list.length > MAX_BATCH) return jsonError(400, "at most " + MAX_BATCH + " candidates");

    // Recorded, but only as a short label. status and every other column stay
    // server-controlled.
    const source = str(body.source, 40, "discover");

    const now = new Date().toISOString();
    const accepted: string[] = [];
    const rejected: { appid: string; reason: string }[] = [];

    const rows: Normalized[] = [];
    for (const raw of list) {
      const n = normalize((raw ?? {}) as CandidateIn);
      if (typeof n === "string") {
        rejected.push({ appid: String((raw as CandidateIn)?.appid ?? "?"), reason: n });
        continue;
      }
      rows.push(n);
      accepted.push(n.appid);
    }

    // A previously DECIDED appid must not be resurrected. The partial unique
    // index only covers OPEN rows, so decided ones need an explicit guard —
    // without it every rejected game returns to the queue on the next sweep.
    if (accepted.length) {
      const decided = await env.DB.prepare(
        "SELECT appid FROM ingest_decisions WHERE appid IN (SELECT value FROM json_each(?))",
      )
        // String(): json_each('[111]') matches nothing against a TEXT column,
        // so a numeric array would silently disable this guard entirely.
        .bind(JSON.stringify(accepted.map(String)))
        .all<{ appid: string }>();
      const skip = new Set((decided.results ?? []).map((r) => r.appid));
      for (let i = rows.length - 1; i >= 0; i--) {
        if (skip.has(rows[i].appid)) {
          rejected.push({ appid: rows[i].appid, reason: "already decided" });
          rows.splice(i, 1);
          accepted.splice(i, 1);
        }
      }
    }

    if (rows.length) {
      await env.DB.batch(
        rows.map((n) =>
          env.DB.prepare(
            `INSERT INTO ingest_queue
               (id, appid, link, name, header_image, release_date, app_type,
                is_free, health_status, reviews_raw, reviews_pct,
                current_players_raw, current_players_num, payload_json,
                source, status, first_seen_at, last_seen_at, seen_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1)
             ON CONFLICT(appid) WHERE status IN ('pending','deferred','approved')
             DO UPDATE SET
               last_seen_at = excluded.last_seen_at,
               seen_count   = ingest_queue.seen_count + 1`,
          ).bind(
            crypto.randomUUID(), n.appid, n.link, n.name, n.header_image,
            n.release_date, n.app_type, n.is_free, n.health_status, n.reviews_raw,
            n.reviews_pct, n.current_players_raw, n.current_players_num,
            n.payload_json, source, now, now,
          ),
        ),
      );
    }

    await env.DB.prepare(
      `INSERT INTO audit_log (actor, action, target, detail_json, created_at)
       VALUES (?, 'ingest.candidates', ?, ?, ?)`,
    )
      .bind(
        who.email,
        source,
        JSON.stringify({ accepted: rows.length, rejected: rejected.length }),
        now,
      )
      .run();

    return json({ accepted: rows.length, rejected });
  }

  return jsonError(404, "not found");
}
