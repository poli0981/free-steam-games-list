/**
 * Admin API. Every route here is authenticated by the caller (worker/index.ts)
 * BEFORE dispatch — never per-handler, because the next handler added is the
 * one that forgets.
 *
 * Cloudflare Access gates these paths at the edge as well. The Worker-side
 * check is not redundant: it is what keeps a repository-write credential safe
 * if the edge policy is ever wrong.
 */
import { jsonError, SECURITY_HEADERS } from "../lib/http";
import type { AccessIdentity } from "../lib/access";
import { gh } from "../lib/github-app";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Admin responses are per-identity and must never be shared by a cache.
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

async function audit(
  env: Env,
  actor: string,
  action: string,
  target: string | null,
  detail: unknown = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (actor, action, target, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(actor, action, target, JSON.stringify(detail), new Date().toISOString())
    .run();
}

export async function handleAdminApi(
  request: Request,
  url: URL,
  env: Env,
  who: AccessIdentity,
): Promise<Response> {
  const route = url.pathname.slice("/api/admin/".length);

  // Who am I? Confirms the Access -> Worker identity chain end to end.
  if (route === "me" && request.method === "GET") {
    return json({ email: who.email, isServiceToken: who.isServiceToken });
  }

  // Status of the moving parts. Deliberately reports each dependency
  // separately so a failure names itself instead of surfacing as "broken".
  if (route === "health" && request.method === "GET") {
    const out: Record<string, unknown> = { ok: true, actor: who.email };

    try {
      const row = await env.DB.prepare(
        `SELECT status, COUNT(*) AS n FROM ingest_queue GROUP BY status`,
      ).all<{ status: string; n: number }>();
      out.queue = Object.fromEntries((row.results ?? []).map((r) => [r.status, r.n]));
      out.d1 = "ok";
    } catch (err) {
      out.ok = false;
      out.d1 = err instanceof Error ? err.message : String(err);
    }

    // Verifies the App private key, the installation, and its permissions in
    // one call — this is the check that catches a mis-scoped App.
    try {
      const res = await gh(env, "/installation/repositories?per_page=1");
      out.github = res.ok ? "ok" : `${res.status}`;
      if (!res.ok) out.ok = false;
    } catch (err) {
      out.ok = false;
      out.github = err instanceof Error ? err.message : String(err);
    }

    return json(out, out.ok ? 200 : 503);
  }

  // The review queue.
  if (route === "queue" && request.method === "GET") {
    const status = url.searchParams.get("status") ?? "pending";
    if (!/^[a-z]{1,12}$/.test(status)) return jsonError(400, "bad status");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

    const rows = await env.DB.prepare(
      `SELECT id, appid, link, name, header_image, release_date, app_type,
              is_free, health_status, reviews_raw, reviews_pct,
              current_players_raw, current_players_num, source, status,
              first_seen_at, last_seen_at, seen_count
         FROM ingest_queue
        WHERE status = ?
        ORDER BY first_seen_at DESC
        LIMIT ?`,
    )
      .bind(status, limit)
      .all();

    return json({ status, count: rows.results?.length ?? 0, items: rows.results ?? [] });
  }

  // Recent admin actions.
  if (route === "audit" && request.method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
    const rows = await env.DB.prepare(
      `SELECT id, actor, action, target, detail_json, created_at
         FROM audit_log ORDER BY id DESC LIMIT ?`,
    )
      .bind(limit)
      .all();
    return json({ items: rows.results ?? [] });
  }

  // Deliberately not implemented yet: approve/reject write to Git and must not
  // exist as a half-working endpoint. audit() is exercised above so the table
  // and the helper are proven before anything depends on them.
  if (route === "ping" && request.method === "POST") {
    await audit(env, who.email, "ping", null, { at: new Date().toISOString() });
    return json({ ok: true });
  }

  return jsonError(404, "not found");
}
