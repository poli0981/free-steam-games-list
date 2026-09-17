/**
 * Retention for the admin tables, run from the cron (worker/index.ts).
 *
 * audit_log and commit_jobs grew forever: nothing ever deleted a row, and the
 * privacy policy described the audit log without saying how long it is kept.
 * ADMIN_RETENTION_DAYS (wrangler.jsonc) is that number, and
 * docs/PRIVACY_POLICY.md states it - change one, change the other.
 *
 * ingest_queue and ingest_decisions are deliberately NOT pruned: the decisions
 * are what stop the discovery sweep re-proposing a rejected game, and queue
 * history is what the admin screen shows for a game's past rows.
 */
import { audit } from "./audit";

export interface PruneResult {
  cutoff: string;
  audit: number;
  jobs: number;
}

export function retentionDays(env: Pick<Env, "ADMIN_RETENTION_DAYS">): number {
  const days = Number(env.ADMIN_RETENTION_DAYS);
  // Never below a week: a typo in the var must not wipe the evidence trail.
  return Number.isFinite(days) && days >= 7 ? Math.floor(days) : 180;
}

export async function pruneAdminHistory(
  env: Pick<Env, "DB" | "ADMIN_RETENTION_DAYS">,
  now: Date,
): Promise<PruneResult> {
  const cutoff = new Date(now.getTime() - retentionDays(env) * 86_400_000).toISOString();
  const [auditRes, jobsRes] = await env.DB.batch([
    env.DB.prepare("DELETE FROM audit_log WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM commit_jobs WHERE created_at < ?").bind(cutoff),
  ]);
  const result = { cutoff, audit: auditRes.meta.changes ?? 0, jobs: jobsRes.meta.changes ?? 0 };
  // Recorded only when something went, so an idle day leaves no row behind.
  if (result.audit || result.jobs) {
    await audit(env as Env, "retention", "admin.prune", null, result);
  }
  return result;
}

/** Once a day, in the first cron tick after 03:00 UTC. */
export function isPruneTick(now: Date): boolean {
  return now.getUTCHours() === 3 && now.getUTCMinutes() < 15;
}
