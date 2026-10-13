/**
 * The approve path, shared by a reviewer's decision (routes/admin.ts, POST
 * decide) and the auto-approve schedule (lib/auto-approve.ts).
 *
 * Approving does NOT publish. It appends one {"link"} line per game to
 * scripts/temp_info.jsonl and stops; ingest_new.py decides whether the game is
 * real, free and reachable, and lib/reconcile.ts records the outcome once it
 * can observe it. That is why nothing here writes ingest_decisions.
 *
 * The order of operations is the whole design, and the same for both callers:
 *   1. a commit_jobs row, BEFORE the commit, so a Worker that dies mid-flight
 *      leaves a 'pending' job as evidence rather than silence;
 *   2. the commit;
 *   3. the job's outcome, recorded on its own;
 *   4. the rows, in one D1 batch - and only then the audit row.
 * If the commit fails, the rows are left untouched on purpose: a row marked
 * approved with no commit behind it is invisible to the queue AND to reconcile.
 */
import { audit } from "./audit";
import type { AdminDeps } from "./deps";
import { TEMP_INFO_PATH, type AppendRequest } from "./git-commit";
import { DECIDABLE_SQL, publishedSql, type DecideRow } from "./queue-sql";
import { OPEN_STATUSES, sqlList, type SkippedRow } from "../../shared/queue-rules";

export interface ApproveOptions {
  /** commit_jobs.kind, and the audit action (with .failed / .desynced). */
  kind: "approve" | "auto.approve";
  /** The acting identity for D1 (an Access email, or "auto-approve"). Never written to Git. */
  actor: string;
  reason: string;
  append?: Omit<AppendRequest, "reason">;
  /** Rows the caller already reported as skipped, for the audit row's count. */
  skippedBefore?: number;
  /**
   * Leave a failed commit out of the audit log; the caller records it. The
   * schedule does, once per distinct failure, so a GitHub outage does not
   * write a row every fifteen minutes.
   */
  quietFailure?: boolean;
}

export type ApproveOutcome =
  | {
      status: "committed";
      jobId: string;
      /** null when every link was already queued and no commit was made. */
      sha: string | null;
      appended: number;
      alreadyQueued: number;
      decidedIds: string[];
      /** Decidable when read, changed by someone else before the write. */
      concurrent: SkippedRow[];
    }
  /** append.requireEmptyQueue was set and the queue file was not empty. */
  | { status: "busy"; jobId: string }
  | { status: "commit-failed"; jobId: string; message: string }
  /** The commit landed; the rows could not be updated. */
  | { status: "desynced"; jobId: string; sha: string | null; message: string };

export async function approveRows(
  env: Env,
  deps: AdminDeps,
  rows: DecideRow[],
  opts: ApproveOptions,
): Promise<ApproveOutcome> {
  const now = deps.now().toISOString();
  const jobId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO commit_jobs (id, kind, status, target_path, requested_by, created_at)
     VALUES (?, ?, 'pending', ?, ?, ?)`,
  )
    .bind(jobId, opts.kind, TEMP_INFO_PATH, opts.actor, now)
    .run();

  let result;
  try {
    result = await deps.appendLinks(
      env,
      rows.map((r) => r.link),
      { ...opts.append, reason: opts.reason },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare("UPDATE commit_jobs SET status='failed', error=?, finished_at=? WHERE id=?")
      .bind(message.slice(0, 500), deps.now().toISOString(), jobId)
      .run();
    if (!opts.quietFailure) {
      await audit(env, opts.actor, `${opts.kind}.failed`, jobId, { message, count: rows.length, reason: opts.reason });
    }
    return { status: "commit-failed", jobId, message };
  }

  if (result.busy) {
    // Not a failure: the previous batch is still in the queue file. 'conflict'
    // is the job status that already means "the file was not as expected".
    await env.DB.prepare("UPDATE commit_jobs SET status='conflict', error=?, finished_at=? WHERE id=?")
      .bind("the queue file still held the previous batch; nothing committed", deps.now().toISOString(), jobId)
      .run()
      .catch(() => undefined);
    return { status: "busy", jobId };
  }

  // The job's outcome is recorded ON ITS OWN, before the queue batch. It used
  // to share that batch, so when the batch failed the job was rolled back to
  // 'pending' forever despite a commit having landed.
  try {
    await env.DB.prepare("UPDATE commit_jobs SET status='committed', commit_sha=?, error=?, finished_at=? WHERE id=?")
      .bind(result.sha, result.sha ? null : "nothing to commit: every link was already queued", deps.now().toISOString(), jobId)
      .run();
  } catch (err) {
    console.error("approve: commit_jobs update failed", err instanceof Error ? err.message : String(err));
  }

  const notPublished = `AND NOT ${publishedSql("ingest_queue")}`;
  let results: D1Result[];
  try {
    results = await env.DB.batch(
      rows.flatMap((r) => [
        // Stand any RIVAL open row for this appid down FIRST.
        //
        // uq_queue_open_appid covers ('pending','deferred','approved') but not
        // 'failed', so a failed row can coexist with a fresh pending row for
        // the same appid. Promoting this one into 'approved' while the other is
        // still open violates the index and throws. D1 runs a batch
        // sequentially in one transaction, so demoting the rival before the
        // promotion keeps the index satisfied at every step.
        env.DB.prepare(
          `UPDATE ingest_queue
              SET status='failed', reject_reason='superseded by a duplicate approval'
            WHERE appid=? AND id<>? AND status IN (${sqlList(OPEN_STATUSES)})`,
        ).bind(r.appid, r.id),
        env.DB.prepare(
          `UPDATE ingest_queue
              SET status='approved', decided_by=?, decided_at=?, reject_reason=NULL
            WHERE id=? AND status IN (${DECIDABLE_SQL}) ${notPublished}`,
        ).bind(opts.actor, now, r.id),
      ]),
    );
  } catch (err) {
    // The commit LANDED; only the bookkeeping failed.
    const message = err instanceof Error ? err.message : String(err);
    await audit(env, opts.actor, `${opts.kind}.desynced`, jobId, {
      message,
      sha: result.sha,
      appids: rows.map((r) => r.appid),
      reason: opts.reason,
    });
    return { status: "desynced", jobId, sha: result.sha, message };
  }

  const decidedIds: string[] = [];
  const concurrent: SkippedRow[] = [];
  rows.forEach((row, i) => {
    if ((results[i * 2 + 1]?.meta?.changes ?? 0) > 0) decidedIds.push(row.id);
    else concurrent.push({ id: row.id, appid: row.appid, reason: "changed-concurrently" });
  });

  await audit(env, opts.actor, opts.kind, jobId, {
    appids: rows.map((r) => r.appid),
    sha: result.sha,
    appended: result.appended,
    already_queued: result.skipped.length,
    skipped: (opts.skippedBefore ?? 0) + concurrent.length,
    reason: opts.reason,
  });

  return {
    status: "committed",
    jobId,
    sha: result.sha,
    appended: result.appended,
    alreadyQueued: result.skipped.length,
    decidedIds,
    concurrent,
  };
}
