/**
 * One Worker commit through commitFiles(), with its commit_jobs row.
 *
 * The job is written BEFORE the attempt, like an approval's: a Worker that
 * dies mid-flight leaves a 'pending' job as evidence rather than no trace at
 * all. Used by overrides (routes/edit.ts) and by removals (routes/remove.ts).
 */
import { audit } from "./audit";
import type { AdminDeps } from "./deps";
import type { FileEdit } from "./git-commit";

export interface CommitPlan {
  /** commit_jobs.kind; the failure audit action is `${kind}.failed`. */
  kind: string;
  appids: string[];
  targetPath: string;
  headline: string;
  body: string;
  edits: FileEdit[];
  auditDetail: Record<string, unknown>;
  /**
   * Write the success audit row here. Off for a caller that still has D1 work
   * to do after the commit and audits the whole outcome itself.
   */
  auditOnSuccess?: boolean;
}

export type CommitOutcome =
  | { ok: true; jobId: string; sha: string | null }
  | { ok: false; jobId: string; message: string };

export async function commitWithJob(
  env: Env,
  deps: AdminDeps,
  actor: string,
  plan: CommitPlan,
): Promise<CommitOutcome> {
  const jobId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO commit_jobs (id, kind, status, target_path, requested_by, created_at)
       VALUES (?, ?, 'pending', ?, ?, ?)`,
    )
      .bind(jobId, plan.kind, plan.targetPath.slice(0, 500), actor, deps.now().toISOString())
      .run();
  } catch (err) {
    // The commit is the point; a bookkeeping failure must not block it.
    console.error(`${plan.kind}: commit_jobs insert failed`, err instanceof Error ? err.message : String(err));
  }

  let sha: string | null;
  try {
    sha = await deps.commitFiles(env, plan.edits, plan.headline, plan.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare("UPDATE commit_jobs SET status='failed', error=?, finished_at=? WHERE id=?")
      .bind(message.slice(0, 500), deps.now().toISOString(), jobId)
      .run()
      .catch(() => undefined);
    await audit(env, actor, `${plan.kind}.failed`, plan.appids.join(",").slice(0, 500), { ...plan.auditDetail, message });
    return { ok: false, jobId, message };
  }

  await env.DB.prepare("UPDATE commit_jobs SET status='committed', commit_sha=?, error=?, finished_at=? WHERE id=?")
    .bind(sha, sha ? null : "nothing to commit: the files already said this", deps.now().toISOString(), jobId)
    .run()
    .catch((err: unknown) =>
      console.error(`${plan.kind}: commit_jobs update failed`, err instanceof Error ? err.message : String(err)),
    );

  if (plan.auditOnSuccess !== false) {
    // Best-effort on purpose: the commit has already landed, so a D1 failure
    // here must not report it as failed. See lib/audit.ts.
    await audit(env, actor, plan.kind, plan.appids.join(",").slice(0, 500), { ...plan.auditDetail, sha, job: jobId });
  }
  return { ok: true, jobId, sha };
}
