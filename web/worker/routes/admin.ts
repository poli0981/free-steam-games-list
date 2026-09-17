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
import { TEMP_INFO_PATH } from "../lib/git-commit";
import { reconcileApproved } from "../lib/reconcile";
import { readLease } from "../lib/locks";
import { retentionDays } from "../lib/prune";
import { defaultAdminDeps, type AdminDeps } from "../lib/deps";
import { handleEditApi } from "./edit";
import {
  DECIDABLE,
  DECIDE_ACTIONS,
  MAX_DECIDE,
  OPEN_STATUSES,
  QUEUE_STATUSES,
  isDecidable,
  isNoOp,
  sqlList,
  type DecideAction,
  type SkippedRow,
} from "../../shared/queue-rules";

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

/**
 * Whether the game a row names is already published, as SQL over `alias`.
 *
 * Per GAME, not per row: a committed row for the appid (reconcile saw it in
 * data/), or an approved decision (the durable record of the same fact, which
 * outlives queue history). Every decide UPDATE repeats this in its WHERE
 * clause, so a page held open across a reconcile cannot act on a game that
 * went live in the meantime.
 */
function publishedSql(alias: string): string {
  return `(EXISTS (SELECT 1 FROM ingest_decisions pd WHERE pd.appid = ${alias}.appid AND pd.decision = 'approved')
        OR EXISTS (SELECT 1 FROM ingest_queue pc WHERE pc.appid = ${alias}.appid AND pc.status = 'committed'))`;
}

/** Another OPEN row for the same appid (the rows uq_queue_open_appid counts). */
function openSiblingSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM ingest_queue os WHERE os.appid = ${alias}.appid AND os.id <> ${alias}.id
                     AND os.status IN (${sqlList(OPEN_STATUSES)}))`;
}

const DECIDABLE_SQL = sqlList(DECIDABLE);

interface DecideRow {
  id: string;
  appid: string;
  link: string;
  name: string;
  status: string;
  first_seen_at: string;
  published: number;
  open_sibling: number;
}

export async function handleAdminApi(
  request: Request,
  url: URL,
  env: Env,
  who: AccessIdentity,
  deps: AdminDeps = defaultAdminDeps,
): Promise<Response> {
  const route = url.pathname.slice("/api/admin/".length);

  // Corrections to already-published games live in their own module; they
  // write data/overrides/, never data/ and never the queue.
  if (route === "game" || route === "edit" || route === "genres" || route === "by-genre") {
    return handleEditApi(request, url, env, who, deps);
  }

  // Who am I? Confirms the Access -> Worker identity chain end to end.
  if (route === "me" && request.method === "GET") {
    return json({ email: who.email, isServiceToken: who.isServiceToken });
  }

  // Status of the moving parts. Always a JSON body, 200 or 503: the old
  // response omitted `error` on a 503, so the page threw "HTTP 503" and never
  // drew the table - the health view was blank exactly when it was needed.
  if (route === "health" && request.method === "GET") {
    const out: Record<string, unknown> = { ok: true, actor: who.email, retentionDays: retentionDays(env) };

    try {
      const row = await env.DB.prepare(
        `SELECT status, COUNT(*) AS n FROM ingest_queue GROUP BY status`,
      ).all<{ status: string; n: number }>();
      out.queue = Object.fromEntries((row.results ?? []).map((r) => [r.status, r.n]));
      out.d1 = "ok";
    } catch (err) {
      out.ok = false;
      // "error", not the message: a D1 driver message can carry SQL fragments.
      // The detail goes to Workers Logs instead.
      out.d1 = "error";
      console.error("health: d1", err instanceof Error ? err.message : String(err));
    }

    // Applied migrations, so a Worker deployed ahead of its migration is
    // visible here rather than only as degraded behaviour.
    try {
      const rows = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
      out.migrations = (rows.results ?? []).map((r) => r.name);
    } catch {
      out.migrations = null;
    }
    try {
      out.lock = await readLease(env.DB, "reconcile");
    } catch {
      out.lock = null;
    }

    // Verifies the App private key, the installation, and its permissions in
    // one call — this is the check that catches a mis-scoped App.
    try {
      const res = await deps.gh(env, "/installation/repositories?per_page=1");
      out.github = res.ok ? "ok" : `${res.status}`;
      if (!res.ok) out.ok = false;
    } catch (err) {
      out.ok = false;
      // github-app.ts embeds GitHub's raw response body in this message.
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
    // Search is SERVER-side. The page used to filter only the 60 rows it had
    // loaded, so typing an appid that sat on page 3 reported "Nothing on this
    // page matches that filter" - indistinguishable from "not in the queue".
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    // status=all searches every tab at once - but only WITH a query, so it
    // cannot become a way to page through the whole table in one listing.
    const all = status === "all";
    if (all ? !q : !(QUEUE_STATUSES as readonly string[]).includes(status)) {
      return jsonError(400, all ? "status=all needs a search query" : "bad status");
    }
    const limit = clampLimit(url.searchParams.get("limit"), 50, 200);
    const offset = clampOffset(url.searchParams.get("offset"));

    // LIKE with an escaped pattern, so a reviewer pasting a name containing %
    // or _ searches for those characters rather than wildcards.
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (!all) {
      clauses.push("q.status = ?");
      args.push(status);
    }
    if (like) {
      clauses.push("(q.name LIKE ? ESCAPE '\\' OR q.appid LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
    const where = clauses.join(" AND ");

    // ORDER BY is a closed set mapped to fixed SQL, never interpolated from
    // the caller.
    const SORTS: Record<string, string> = {
      newest: "q.first_seen_at DESC, q.id",
      oldest: "q.first_seen_at ASC, q.id",
      players: "q.current_players_num DESC NULLS LAST, q.id",
      reviews: "q.reviews_pct DESC NULLS LAST, q.id",
      name: "q.name COLLATE NOCASE ASC, q.id",
      decided: "q.decided_at DESC NULLS LAST, q.id",
    };
    const sortKey = url.searchParams.get("sort") ?? "newest";
    const orderBy = SORTS[sortKey] ?? SORTS.newest;

    // first_seen_at alone is not unique -- a whole sweep shares one timestamp
    // -- so every ordering above breaks the tie on id, or rows would swap
    // places between pages and a game could be shown twice or never.
    const rows = await env.DB.prepare(
      `SELECT q.id, q.appid, q.link, q.name, q.header_image, q.release_date, q.app_type,
              q.is_free, q.health_status, q.reviews_raw, q.reviews_pct,
              q.current_players_raw, q.current_players_num, q.source, q.status,
              q.decided_by, q.decided_at, q.reject_reason,
              q.first_seen_at, q.last_seen_at, q.seen_count,
              ${publishedSql("q")} AS published
         FROM ingest_queue q
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit, offset)
      .all<Record<string, unknown>>();

    const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ingest_queue q WHERE ${where}`)
      .bind(...args)
      .first<{ n: number }>();

    return json({
      status,
      offset,
      limit,
      q,
      sort: sortKey in SORTS ? sortKey : "newest",
      total: total?.n ?? 0,
      count: rows.results?.length ?? 0,
      items: (rows.results ?? []).map((r) => ({ ...r, published: Boolean(r.published) })),
      maxDecide: MAX_DECIDE,
    });
  }

  // One row in full: the candidate as it arrived, its decision, and every
  // other row the queue holds for the same game.
  if (route === "candidate" && request.method === "GET") {
    const id = (url.searchParams.get("id") ?? "").slice(0, 64);
    if (!id) return jsonError(400, "id is required");
    const row = await env.DB.prepare(
      `SELECT q.id, q.appid, q.link, q.name, q.header_image, q.status, q.reject_reason,
              q.decided_by, q.decided_at, q.payload_json, q.first_seen_at, q.last_seen_at,
              q.seen_count, q.health_status, q.app_type, q.is_free, q.source,
              ${publishedSql("q")} AS published
         FROM ingest_queue q WHERE q.id = ?`,
    )
      .bind(id)
      .first<Record<string, unknown> & { appid: string }>();
    if (!row) return jsonError(404, "not found");

    const [decision, siblings] = await Promise.all([
      env.DB.prepare(
        "SELECT decision, reason, decided_by, decided_at FROM ingest_decisions WHERE appid = ?",
      )
        .bind(row.appid)
        .first(),
      env.DB.prepare(
        `SELECT id, status, reject_reason, decided_by, decided_at, first_seen_at
           FROM ingest_queue WHERE appid = ? AND id <> ? ORDER BY first_seen_at DESC LIMIT 20`,
      )
        .bind(row.appid, id)
        .all(),
    ]);
    return json({
      ...row,
      published: Boolean(row.published),
      decision: decision ?? null,
      siblings: siblings.results ?? [],
    });
  }

  // Recent admin actions, paged and filterable.
  if (route === "audit" && request.method === "GET") {
    const limit = clampLimit(url.searchParams.get("limit"), 50, 200);
    const offset = clampOffset(url.searchParams.get("offset"));
    const clauses: string[] = [];
    const args: unknown[] = [];
    const action = url.searchParams.get("action") ?? "";
    if (action) {
      if (!/^[a-z][a-z.]{0,39}$/.test(action)) return jsonError(400, "bad action");
      clauses.push("action = ?");
      args.push(action);
    }
    const actor = (url.searchParams.get("actor") ?? "").slice(0, 200);
    if (actor) {
      clauses.push("actor = ?");
      args.push(actor);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows, total] = await Promise.all([
      env.DB.prepare(
        `SELECT id, actor, action, target, detail_json, created_at
           FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
        .bind(...args, limit, offset)
        .all(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log ${where}`)
        .bind(...args)
        .first<{ n: number }>(),
    ]);
    return json({ items: rows.results ?? [], total: total?.n ?? 0, limit, offset });
  }

  // commit_jobs: the record of every Worker commit attempt, written BEFORE the
  // attempt - the evidence that a commit died mid-flight.
  if (route === "jobs" && request.method === "GET") {
    const limit = clampLimit(url.searchParams.get("limit"), 50, 200);
    const offset = clampOffset(url.searchParams.get("offset"));
    const clauses: string[] = [];
    const args: unknown[] = [];
    const status = url.searchParams.get("status") ?? "";
    if (status) {
      if (!["pending", "committed", "conflict", "failed"].includes(status)) return jsonError(400, "bad status");
      clauses.push("status = ?");
      args.push(status);
    }
    const kind = url.searchParams.get("kind") ?? "";
    if (kind) {
      if (!/^[a-z][a-z.]{0,31}$/.test(kind)) return jsonError(400, "bad kind");
      clauses.push("kind = ?");
      args.push(kind);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows, total] = await Promise.all([
      env.DB.prepare(
        `SELECT id, kind, status, target_path, commit_sha, error, requested_by, created_at, finished_at
           FROM commit_jobs ${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
      )
        .bind(...args, limit, offset)
        .all(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM commit_jobs ${where}`)
        .bind(...args)
        .first<{ n: number }>(),
    ]);
    return json({ items: rows.results ?? [], total: total?.n ?? 0, limit, offset });
  }

  if (route === "ping" && request.method === "POST") {
    await audit(env, who.email, "ping", null, { at: deps.now().toISOString() });
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
  //
  // Every named row is either decided or reported back in `skipped` with a
  // reason. The old handler dropped non-decidable rows silently, so a mixed
  // selection reported "approve: 3 rows" for five selected.
  if (route === "decide" && request.method === "POST") {
    let body: { ids?: unknown; action?: unknown; reason?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError(400, "invalid json");
    }

    const action = (typeof body.action === "string" ? body.action : "") as DecideAction;
    if (!(DECIDE_ACTIONS as readonly string[]).includes(action)) {
      return jsonError(400, "action must be approve, reject, defer or requeue");
    }

    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.filter((i): i is string => typeof i === "string" && i.length > 0 && i.length <= 64))]
      : [];
    if (!ids.length) return jsonError(400, "ids must be a non-empty array");
    if (ids.length > MAX_DECIDE) return jsonError(400, "at most " + MAX_DECIDE + " ids");

    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";

    // Re-read server-side. The client sends ids and nothing else: a request
    // that could name its own link would let this endpoint queue an arbitrary
    // URL into a repository file.
    const found = await env.DB.prepare(
      `SELECT q.id, q.appid, q.link, q.name, q.status, q.first_seen_at,
              ${publishedSql("q")} AS published,
              ${openSiblingSql("q")} AS open_sibling
         FROM ingest_queue q
        WHERE q.id IN (SELECT value FROM json_each(?))`,
    )
      .bind(JSON.stringify(ids))
      .all<DecideRow>();

    const byId = new Map((found.results ?? []).map((r) => [r.id, r]));
    const skipped: SkippedRow[] = [];
    const candidates: DecideRow[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) skipped.push({ id, appid: null, reason: "not-found" });
      else if (!isDecidable(row.status)) skipped.push({ id, appid: row.appid, reason: "not-decidable" });
      else if (row.published) skipped.push({ id, appid: row.appid, reason: "published" });
      else if (isNoOp(action, row.status)) skipped.push({ id, appid: row.appid, reason: "no-op" });
      // Moving a failed row back into an open state while the appid already
      // has an open row would violate uq_queue_open_appid - which used to
      // throw inside the batch and fail the whole request with a 500.
      else if ((action === "defer" || action === "requeue") && row.open_sibling) {
        skipped.push({ id, appid: row.appid, reason: "open-row-exists" });
      } else candidates.push(row);
    }

    // One row per game: the newest wins, the rest are reported.
    candidates.sort((a, b) => (a.first_seen_at < b.first_seen_at ? 1 : a.first_seen_at > b.first_seen_at ? -1 : 0));
    const rows: DecideRow[] = [];
    const appids = new Set<string>();
    for (const row of candidates) {
      if (appids.has(row.appid)) skipped.push({ id: row.id, appid: row.appid, reason: "duplicate-in-request" });
      else {
        appids.add(row.appid);
        rows.push(row);
      }
    }

    if (!rows.length) {
      return new Response(JSON.stringify({ error: "nothing in that selection can be decided", skipped }), {
        status: 409,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
      });
    }

    const now = deps.now().toISOString();
    // Rows that were decidable when read but changed before the write.
    const settle = (results: D1Result[], perRow: number, offsetInBatch: number) => {
      const decidedIds: string[] = [];
      rows.forEach((row, i) => {
        const res = results[offsetInBatch + i * perRow + (perRow - 1)];
        if ((res?.meta?.changes ?? 0) > 0) decidedIds.push(row.id);
        else skipped.push({ id: row.id, appid: row.appid, reason: "changed-concurrently" });
      });
      return decidedIds;
    };

    const notPublished = `AND NOT ${publishedSql("ingest_queue")}`;

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
        result = await deps.appendLinks(env, rows.map((r) => r.link), who.email, reason);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await env.DB.prepare(
          "UPDATE commit_jobs SET status='failed', error=?, finished_at=? WHERE id=?",
        )
          .bind(message.slice(0, 500), deps.now().toISOString(), jobId)
          .run();
        await audit(env, who.email, "approve.failed", jobId, { message, count: rows.length, reason });
        // Rows are deliberately left untouched. A row marked approved with no
        // commit behind it is invisible to the queue AND to the reconciler.
        return jsonError(502, "commit failed: " + message);
      }

      // The job's outcome is recorded ON ITS OWN, before the queue batch. It
      // used to share that batch, so when the batch failed the job was rolled
      // back to 'pending' forever despite a commit having landed.
      try {
        await env.DB.prepare(
          "UPDATE commit_jobs SET status='committed', commit_sha=?, error=?, finished_at=? WHERE id=?",
        )
          .bind(result.sha, result.sha ? null : "nothing to commit: every link was already queued", deps.now().toISOString(), jobId)
          .run();
      } catch (err) {
        console.error("approve: commit_jobs update failed", err instanceof Error ? err.message : String(err));
      }

      let decidedIds: string[];
      try {
        const results = await env.DB.batch(
          rows.flatMap((r) => [
            // Stand any RIVAL open row for this appid down FIRST.
            //
            // uq_queue_open_appid covers ('pending','deferred','approved') but
            // not 'failed', so a failed row can coexist with a fresh pending
            // row for the same appid. Promoting this one into 'approved' while
            // the other is still open violates the index and throws. D1 runs a
            // batch sequentially in one transaction, so demoting the rival
            // before the promotion keeps the index satisfied at every step.
            env.DB.prepare(
              `UPDATE ingest_queue
                  SET status='failed', reject_reason='superseded by a duplicate approval'
                WHERE appid=? AND id<>? AND status IN (${sqlList(OPEN_STATUSES)})`,
            ).bind(r.appid, r.id),
            env.DB.prepare(
              `UPDATE ingest_queue
                  SET status='approved', decided_by=?, decided_at=?, reject_reason=NULL
                WHERE id=? AND status IN (${DECIDABLE_SQL}) ${notPublished}`,
            ).bind(who.email, now, r.id),
          ]),
        );
        decidedIds = settle(results, 2, 0);
      } catch (err) {
        // The commit LANDED; only the bookkeeping failed. Say exactly that,
        // and what happens next.
        const message = err instanceof Error ? err.message : String(err);
        await audit(env, who.email, "approve.desynced", jobId, {
          message, sha: result.sha, appids: rows.map((r) => r.appid), reason,
        });
        return jsonError(
          500,
          `commit ${result.sha ?? "(none - already queued)"} landed but the queue could not be updated (${message}). ` +
            "The rows are unchanged, so approving them again is safe and will not queue them twice. " +
            "Once the pipeline publishes the games, reconcile marks these rows committed on its own.",
        );
      }

      await audit(env, who.email, "approve", jobId, {
        appids: rows.map((r) => r.appid),
        sha: result.sha,
        appended: result.appended,
        already_queued: result.skipped.length,
        skipped: skipped.length,
        reason,
      });

      return json({
        action,
        decided: decidedIds.length,
        decidedIds,
        skipped,
        // null when every link was already queued - the UI reads this to avoid
        // announcing a commit that was never made.
        commit: result.sha,
        appended: result.appended,
        already_queued: result.skipped.length,
      });
    }

    if (action === "reject") {
      const results = await env.DB.batch(
        rows.flatMap((r) => [
          // Durable, so tomorrow's sweep does not offer it again. The partial
          // unique index only covers OPEN rows, so this table is what makes a
          // rejection stick. Written only for a row that is really being
          // rejected (the same guards as the UPDATE below), and never over an
          // 'approved' decision: that one records a publication, which is a
          // fact rather than a preference.
          env.DB.prepare(
            `INSERT INTO ingest_decisions (appid, decision, reason, decided_by, decided_at)
             SELECT q.appid, 'rejected', ?, ?, ? FROM ingest_queue q
              WHERE q.id = ? AND q.status IN (${DECIDABLE_SQL}) AND NOT ${publishedSql("q")}
             ON CONFLICT(appid) DO UPDATE SET
               decision=excluded.decision, reason=excluded.reason,
               decided_by=excluded.decided_by, decided_at=excluded.decided_at
             WHERE ingest_decisions.decision <> 'approved'`,
          ).bind(reason || null, who.email, now, r.id),
          env.DB.prepare(
            `UPDATE ingest_queue
                SET status='rejected', decided_by=?, decided_at=?, reject_reason=?
              WHERE id=? AND status IN (${DECIDABLE_SQL}) ${notPublished}`,
          ).bind(who.email, now, reason || null, r.id),
        ]),
      );
      const decidedIds = settle(results, 2, 0);
      await audit(env, who.email, "reject", null, {
        appids: rows.filter((r) => decidedIds.includes(r.id)).map((r) => r.appid),
        reason,
        skipped: skipped.length,
      });
      return json({ action, decided: decidedIds.length, decidedIds, skipped });
    }

    // defer / requeue both just move a row between OPEN states, so neither
    // touches ingest_decisions - the appid stays blocked by the partial unique
    // index and stays known to /api/ingest/known.
    const target = action === "defer" ? "deferred" : "pending";
    const results = await env.DB.batch(
      rows.map((r) =>
        env.DB.prepare(
          `UPDATE ingest_queue SET status=?, reject_reason=NULL
            WHERE id=? AND status IN (${DECIDABLE_SQL}) AND status <> ? ${notPublished}
              AND NOT ${openSiblingSql("ingest_queue")}`,
        ).bind(target, r.id, target),
      ),
    );
    const decidedIds = settle(results, 1, 0);
    await audit(env, who.email, action, null, {
      appids: rows.filter((r) => decidedIds.includes(r.id)).map((r) => r.appid),
      reason,
      skipped: skipped.length,
    });
    return json({ action, decided: decidedIds.length, decidedIds, skipped });
  }

  // Reopen ONE rejected row: back to pending, and its rejection forgotten, so
  // the discovery sweep and the reviewer can see the game again. This replaced
  // a raw-SQL runbook step.
  if (route === "reopen" && request.method === "POST") {
    let body: { id?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError(400, "invalid json");
    }
    const id = typeof body.id === "string" ? body.id.slice(0, 64) : "";
    if (!id) return jsonError(400, "id is required");

    // The same three conditions guard both statements, evaluated against the
    // same state inside one transaction, so the decision is deleted if and
    // only if the row is reopened:
    //   - the row is rejected,
    //   - no other row for the appid is open or committed,
    //   - the game has no approved decision (it is not published).
    // Only a 'rejected' decision is ever deleted.
    const guard = (alias: string) => `
          ${alias}.status = 'rejected'
      AND NOT EXISTS (SELECT 1 FROM ingest_queue o WHERE o.appid = ${alias}.appid AND o.id <> ${alias}.id
                        AND o.status IN (${sqlList([...OPEN_STATUSES, "committed"])}))
      AND NOT EXISTS (SELECT 1 FROM ingest_decisions d WHERE d.appid = ${alias}.appid AND d.decision = 'approved')`;

    const results = await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM ingest_decisions
          WHERE decision = 'rejected'
            AND appid = (SELECT q.appid FROM ingest_queue q WHERE q.id = ?1 AND ${guard("q")})`,
      ).bind(id),
      env.DB.prepare(
        `UPDATE ingest_queue
            SET status = 'pending', decided_by = NULL, decided_at = NULL, reject_reason = NULL
          WHERE id = ?1 AND ${guard("ingest_queue")}`,
      ).bind(id),
    ]);

    if ((results[1]?.meta?.changes ?? 0) === 0) {
      const row = await env.DB.prepare(
        `SELECT q.status, q.appid, ${publishedSql("q")} AS published FROM ingest_queue q WHERE q.id = ?`,
      )
        .bind(id)
        .first<{ status: string; appid: string; published: number }>();
      if (!row) return jsonError(404, "not found");
      const reason = row.status !== "rejected" ? "not-rejected" : row.published ? "published" : "open-row-exists";
      return new Response(JSON.stringify({ error: `cannot reopen: ${reason}`, reason }), {
        status: 409,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
      });
    }

    const reopened = await env.DB.prepare("SELECT appid FROM ingest_queue WHERE id = ?").bind(id).first<{ appid: string }>();
    await audit(env, who.email, "reopen", id, { appid: reopened?.appid ?? null });
    return json({ reopened: id, appid: reopened?.appid ?? null });
  }

  // Manual reconcile. The cron runs this on a schedule; the button exists so a
  // reviewer who just watched the pipeline finish need not wait for it.
  if (route === "reconcile" && request.method === "POST") {
    const out = await reconcileApproved(env, deps, { manual: true });
    await audit(env, who.email, "reconcile.manual", null, out);
    return json(out);
  }

  return jsonError(404, "not found");
}
