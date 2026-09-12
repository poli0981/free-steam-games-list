/**
 * Admin API. Every route here is authenticated by the caller (worker/index.ts)
 * BEFORE dispatch — never per-handler, because the next handler added is the
 * one that forgets.
 *
 * Cloudflare Access gates these paths at the edge as well. The Worker-side
 * check is not redundant: it is what keeps a repository-write credential safe
 * if the edge policy is ever wrong.
 */
import { jsonError, SECURITY_HEADERS, clampLimit, clampOffset } from "../lib/http";
import { audit } from "../lib/audit";
import type { AccessIdentity } from "../lib/access";
import { gh } from "../lib/github-app";
import { appendLinks, TEMP_INFO_PATH } from "../lib/git-commit";
import { reconcileApproved } from "../lib/reconcile";
import { handleEditApi } from "./edit";

/**
 * Per-request cap on a bulk decision. Bounds three things at once: the D1
 * batch, the size of a single commit, and how much one mis-click can do.
 */
const MAX_DECIDE = 100;

/**
 * Statuses a row may be decided FROM. A committed row is finished.
 *
 * Enforced TWICE on purpose: once when the rows are read, and again in the
 * WHERE clause of every UPDATE. The read-then-write gap is real — an admin
 * page held open across a reconcile, or two reviewers acting at once — and
 * without the second check a stale page could reject a game whose approval had
 * already been committed to Git, or one the pipeline had already published.
 * Every branch below carries the guard; do not add one that skips it.
 */
const DECIDABLE = ["pending", "deferred", "failed"];

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


export async function handleAdminApi(
  request: Request,
  url: URL,
  env: Env,
  who: AccessIdentity,
): Promise<Response> {
  const route = url.pathname.slice("/api/admin/".length);

  // Corrections to already-published games live in their own module; they
  // write data/overrides/, never data/ and never the queue.
  if (route === "game" || route === "edit" || route === "genres" || route === "by-genre") {
    return handleEditApi(request, url, env, who);
  }

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
      // "error", not the message. This is behind Access so the exposure is
      // small, but a D1 driver message can carry SQL fragments and column
      // names, and there is no reason for a health endpoint to be the place
      // they surface. The detail goes to Workers Logs instead.
      out.d1 = "error";
      console.error("health: d1", err instanceof Error ? err.message : String(err));
    }

    // Verifies the App private key, the installation, and its permissions in
    // one call — this is the check that catches a mis-scoped App.
    try {
      const res = await gh(env, "/installation/repositories?per_page=1");
      out.github = res.ok ? "ok" : `${res.status}`;
      if (!res.ok) out.ok = false;
    } catch (err) {
      out.ok = false;
      // Same reasoning, and more pressing: github-app.ts embeds GitHub's raw
      // response body in this message, which on a mis-scoped App includes the
      // installation details.
      out.github = "error";
      console.error("health: github", err instanceof Error ? err.message : String(err));
    }

    return json(out, out.ok ? 200 : 503);
  }

  // Counts for every status in one query, so the UI can label its tabs without
  // one request per tab.
  if (route === "stats" && request.method === "GET") {
    const [queue, jobs] = await Promise.all([
      env.DB.prepare(
        "SELECT status, COUNT(*) AS n FROM ingest_queue GROUP BY status",
      ).all<{ status: string; n: number }>(),
      env.DB.prepare(
        `SELECT status, COUNT(*) AS n FROM commit_jobs GROUP BY status`,
      ).all<{ status: string; n: number }>(),
    ]);
    return json({
      queue: Object.fromEntries((queue.results ?? []).map((r) => [r.status, r.n])),
      commits: Object.fromEntries((jobs.results ?? []).map((r) => [r.status, r.n])),
    });
  }

  // The review queue.
  if (route === "queue" && request.method === "GET") {
    const status = url.searchParams.get("status") ?? "pending";
    if (!/^[a-z]{1,12}$/.test(status)) return jsonError(400, "bad status");
    const limit = clampLimit(url.searchParams.get("limit"), 50, 200);
    const offset = clampOffset(url.searchParams.get("offset"));

    // Search is SERVER-side. The page used to filter only the 60 rows it had
    // loaded, so typing an appid that sat on page 3 reported "Nothing on this
    // page matches that filter" - indistinguishable from "not in the queue".
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    // LIKE with an escaped pattern, so a reviewer pasting a name containing %
    // or _ searches for those characters rather than wildcards.
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
    const where = like
      ? "status = ? AND (name LIKE ? ESCAPE '\\' OR appid LIKE ? ESCAPE '\\')"
      : "status = ?";
    const whereArgs: unknown[] = like ? [status, like, like] : [status];

    // ORDER BY is a closed set mapped to fixed SQL, never interpolated from
    // the caller. reviews_pct and current_players_num have been selected since
    // the schema was written - the comment there says they exist "so the
    // review screen can sort" - but nothing ever offered the sort.
    const SORTS: Record<string, string> = {
      newest: "first_seen_at DESC, id",
      oldest: "first_seen_at ASC, id",
      players: "current_players_num DESC NULLS LAST, id",
      reviews: "reviews_pct DESC NULLS LAST, id",
      name: "name COLLATE NOCASE ASC, id",
    };
    const sortKey = url.searchParams.get("sort") ?? "newest";
    const orderBy = SORTS[sortKey] ?? SORTS.newest;

    // first_seen_at alone is not unique -- a whole sweep shares one timestamp
    // -- so every ordering above breaks the tie on id, or rows would swap
    // places between pages and a game could be shown twice or never.
    const rows = await env.DB.prepare(
      `SELECT id, appid, link, name, header_image, release_date, app_type,
              is_free, health_status, reviews_raw, reviews_pct,
              current_players_raw, current_players_num, source, status,
              decided_by, decided_at, reject_reason,
              first_seen_at, last_seen_at, seen_count
         FROM ingest_queue
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
    )
      .bind(...whereArgs, limit, offset)
      .all();

    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ingest_queue WHERE ${where}`,
    )
      .bind(...whereArgs)
      .first<{ n: number }>();

    return json({
      status,
      offset,
      limit,
      q,
      sort: sortKey in SORTS ? sortKey : "newest",
      total: total?.n ?? 0,
      count: rows.results?.length ?? 0,
      items: rows.results ?? [],
      // So the page stops hardcoding 100 as a client-side literal.
      maxDecide: MAX_DECIDE,
    });
  }

  // The full candidate as it arrived, for one row. payload_json is stored
  // verbatim on every insert and was never surfaced anywhere, so the only way
  // to see why a game was proposed was `wrangler d1 execute`.
  if (route === "candidate" && request.method === "GET") {
    const id = (url.searchParams.get("id") ?? "").slice(0, 64);
    if (!id) return jsonError(400, "id is required");
    const row = await env.DB.prepare(
      `SELECT id, appid, name, payload_json, first_seen_at, last_seen_at, seen_count,
              health_status, app_type, is_free, source
         FROM ingest_queue WHERE id = ?`,
    )
      .bind(id)
      .first();
    if (!row) return jsonError(404, "not found");
    return json(row);
  }

  // Recent admin actions.
  if (route === "audit" && request.method === "GET") {
    const limit = clampLimit(url.searchParams.get("limit"), 50, 200);
    const rows = await env.DB.prepare(
      `SELECT id, actor, action, target, detail_json, created_at
         FROM audit_log ORDER BY id DESC LIMIT ?`,
    )
      .bind(limit)
      .all();
    return json({ items: rows.results ?? [] });
  }

  // commit_jobs, which had no UI at all. /api/admin/stats already returned
  // these counts and the page discarded them, so the one table that records a
  // commit attempt BEFORE it is made - the evidence that a commit died
  // mid-flight - was only readable through `wrangler d1 execute`.
  if (route === "jobs" && request.method === "GET") {
    const limit = clampLimit(url.searchParams.get("limit"), 50, 200);
    const rows = await env.DB.prepare(
      `SELECT id, kind, status, target_path, commit_sha, error,
              requested_by, created_at, finished_at
         FROM commit_jobs ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(limit)
      .all();
    return json({ items: rows.results ?? [] });
  }

  if (route === "ping" && request.method === "POST") {
    await audit(env, who.email, "ping", null, { at: new Date().toISOString() });
    return json({ ok: true });
  }

  // Approve / reject / defer / requeue, in bulk.
  //
  // The actions are NOT symmetric, and the asymmetry is the whole design:
  //   reject   is final and local - nothing outside D1 has to agree.
  //   defer    keeps the row open, so the appid stays blocked from re-queueing.
  //   approve  only REQUESTS publication. It commits to scripts/temp_info.jsonl
  //            and stops; ingest_new.py decides whether the game is real, and
  //            lib/reconcile.ts records the outcome once it can observe it.
  if (route === "decide" && request.method === "POST") {
    let body: { ids?: unknown; action?: unknown; reason?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError(400, "invalid json");
    }

    const action = typeof body.action === "string" ? body.action : "";
    if (!["approve", "reject", "defer", "requeue"].includes(action)) {
      return jsonError(400, "action must be approve, reject, defer or requeue");
    }

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((i): i is string => typeof i === "string" && i.length <= 64)
      : [];
    if (!ids.length) return jsonError(400, "ids must be a non-empty array");
    if (ids.length > MAX_DECIDE) return jsonError(400, "at most " + MAX_DECIDE + " ids");

    const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "";

    // Re-read server-side. The client sends ids and nothing else: a request
    // that could name its own link would let this endpoint queue an arbitrary
    // URL into a repository file.
    const placeholders = ids.map(() => "?").join(",");
    const found = await env.DB.prepare(
      "SELECT id, appid, link, name, status FROM ingest_queue WHERE id IN (" + placeholders + ")",
    )
      .bind(...ids)
      .all<{ id: string; appid: string; link: string; name: string; status: string }>();

    const rows = (found.results ?? []).filter((r) => DECIDABLE.includes(r.status));
    if (!rows.length) return jsonError(409, "no decidable rows in that selection");

    const now = new Date().toISOString();

    if (action === "approve") {
      const jobId = crypto.randomUUID();
      // Written BEFORE the commit is attempted: a Worker that dies mid-flight
      // leaves a 'pending' job as evidence rather than no trace at all.
      await env.DB.prepare(
        `INSERT INTO commit_jobs (id, kind, status, target_path, requested_by, created_at)
         VALUES (?, 'approve', 'pending', ?, ?, ?)`,
      )
        .bind(jobId, TEMP_INFO_PATH, who.email, now)
        .run();

      let result;
      try {
        result = await appendLinks(env, rows.map((r) => r.link), who.email);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await env.DB.prepare(
          "UPDATE commit_jobs SET status='failed', error=?, finished_at=? WHERE id=?",
        )
          .bind(message.slice(0, 500), new Date().toISOString(), jobId)
          .run();
        await audit(env, who.email, "approve.failed", jobId, { message, count: rows.length });
        // Rows are deliberately left untouched. A row marked approved with no
        // commit behind it is invisible to the queue AND to the reconciler.
        return jsonError(502, "commit failed: " + message);
      }

      try {
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE commit_jobs SET status='committed', commit_sha=?, finished_at=? WHERE id=?",
          ).bind(result.sha, new Date().toISOString(), jobId),
          ...rows.flatMap((r) => [
            // Stand any RIVAL open row for this appid down FIRST.
            //
            // uq_queue_open_appid covers ('pending','deferred','approved') but
            // not 'failed', so a row reconcile marked failed can coexist with a
            // fresh pending row for the same appid. Promoting this one into
            // 'approved' while the other is still open violates the index and
            // throws - and by then the commit has already landed, so the batch
            // would abort leaving rows pending that are queued in Git. D1 runs
            // a batch sequentially in one transaction, so demoting the rival
            // before the promotion keeps the index satisfied at every step.
            env.DB.prepare(
              `UPDATE ingest_queue
                  SET status='failed', reject_reason='superseded by a duplicate approval'
                WHERE appid=? AND id<>? AND status IN ('pending','deferred','approved')`,
            ).bind(r.appid, r.id),
            env.DB.prepare(
              `UPDATE ingest_queue
                  SET status='approved', decided_by=?, decided_at=?, reject_reason=NULL
                WHERE id=? AND status IN ('pending','deferred','failed')`,
            ).bind(who.email, now, r.id),
          ]),
        ]);
      } catch (err) {
        // The commit LANDED; only the bookkeeping failed. Say so loudly rather
        // than reporting a clean failure: the links are in Git and the pipeline
        // will publish them, but these rows still read as undecided.
        const message = err instanceof Error ? err.message : String(err);
        await audit(env, who.email, "approve.desynced", jobId, {
          message, sha: result.sha, appids: rows.map((r) => r.appid),
        });
        return jsonError(
          500,
          "commit " + (result.sha ?? "(none)") + " landed but the queue was not updated: " +
            message + " - reconcile will still promote these rows once they appear in data/",
        );
      }

      await audit(env, who.email, "approve", jobId, {
        appids: rows.map((r) => r.appid),
        sha: result.sha,
        appended: result.appended,
        skipped: result.skipped.length,
      });

      return json({
        action,
        decided: rows.length,
        // null when every link was already queued - the UI reads this to avoid
        // announcing a commit that was never made.
        commit: result.sha,
        appended: result.appended,
        already_queued: result.skipped.length,
      });
    }

    if (action === "reject") {
      await env.DB.batch(
        rows.flatMap((r) => [
          env.DB.prepare(
            `UPDATE ingest_queue
                SET status='rejected', decided_by=?, decided_at=?, reject_reason=?
              WHERE id=? AND status IN ('pending','deferred','failed')`,
          ).bind(who.email, now, reason || null, r.id),
          // Durable, so tomorrow's sweep does not offer it again. The partial
          // unique index only covers OPEN rows, so this table is what makes a
          // rejection stick.
          //
          // The trailing WHERE is what stops a reject DOWNGRADING an approval.
          // reconcile.ts writes decision='approved' only after observing the
          // appid in data/ - i.e. the game is published, which is a fact rather
          // than a preference. Its insert uses DO NOTHING; this one used a bare
          // DO UPDATE, so the two disagreed about who may overwrite whom, and a
          // reject landing on a re-queued row for an already-published appid
          // silently replaced that record and its attribution. Refuse instead:
          // to actually un-publish a game, remove it from data/.
          env.DB.prepare(
            `INSERT INTO ingest_decisions (appid, decision, reason, decided_by, decided_at)
             VALUES (?, 'rejected', ?, ?, ?)
             ON CONFLICT(appid) DO UPDATE SET
               decision=excluded.decision, reason=excluded.reason,
               decided_by=excluded.decided_by, decided_at=excluded.decided_at
             WHERE ingest_decisions.decision <> 'approved'`,
          ).bind(r.appid, reason || null, who.email, now),
        ]),
      );
      await audit(env, who.email, "reject", null, {
        appids: rows.map((r) => r.appid),
        reason,
      });
      return json({ action, decided: rows.length });
    }

    // defer / requeue both just move a row between OPEN states, so neither
    // touches ingest_decisions - the appid stays blocked by the partial unique
    // index and stays known to /api/ingest/known.
    const target = action === "defer" ? "deferred" : "pending";
    await env.DB.batch(
      rows.map((r) =>
        env.DB.prepare(
          `UPDATE ingest_queue SET status=?, reject_reason=NULL
            WHERE id=? AND status IN ('pending','deferred','failed')`,
        ).bind(target, r.id),
      ),
    );
    await audit(env, who.email, action, null, { appids: rows.map((r) => r.appid) });
    return json({ action, decided: rows.length });
  }

  // Manual reconcile. The cron runs this on a schedule; the button exists so a
  // reviewer who just watched the pipeline finish need not wait for it.
  if (route === "reconcile" && request.method === "POST") {
    const out = await reconcileApproved(env);
    await audit(env, who.email, "reconcile.manual", null, out);
    return json(out);
  }

  return jsonError(404, "not found");
}
