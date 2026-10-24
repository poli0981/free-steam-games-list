/**
 * Auto-approve: the cron approves pending games in batches, within limits a
 * person set in /admin/automation. Off by default.
 *
 * It approves exactly the way a reviewer does (lib/approve.ts): a request in
 * scripts/temp_info.jsonl, which ingest_new.py still checks game by game -
 * free, reachable, a game (not a DLC, demo or tool), not already present. It
 * never publishes anything itself.
 *
 * A batch is committed only when ALL of these hold:
 *   - it is enabled (or a person pressed "Run one batch now");
 *   - nobody else is mid-run (D1 lease; no lease table means no run);
 *   - today's budget is not spent (min(dailyLimit, AUTO_DAILY_CEILING), UTC
 *     day, reserved with bumpCounter BEFORE the commit and returned if it
 *     fails);
 *   - scripts/temp_info.jsonl on main is EMPTY - the previous batch has been
 *     ingested. Checked again atomically inside the commit
 *     (requireEmptyQueue). Not "no row is approved": a network-skipped row
 *     stays approved for 12 hours and would stall everything that long;
 *   - no data-write workflow is running or waiting (GitHub Actions). The
 *     group queues its runs (queue: max), so the ingest this commit starts
 *     would no longer evict a job waiting its turn - it would wait behind it.
 *     The gate stays so that a batch lands when the ingest can start at once;
 *   - something is eligible: pending, free, app_type game, health ok, old
 *     enough, from an allowed source, never decided, its game not committed,
 *     not in data/blocklist.jsonl.
 * Any check that cannot be made counts as "no".
 */
import { audit } from "./audit";
import { approveRows } from "./approve";
import { errorText } from "./http";
import type { AdminDeps } from "./deps";
import { TEMP_INFO_PATH } from "./git-commit";
import { activeDataWrite, recentRuns } from "./github-runs";
import { acquireLease, bumpCounter, readState, releaseLease, writeState } from "./locks";
import type { DecideRow } from "./queue-sql";
import {
  AUTO_ACTOR,
  AUTO_DAILY_CEILING,
  AUTO_LAST_KEY,
  AUTO_SETTINGS_KEY,
  autoCountKey,
  parseSettings,
  type AutoLast,
  type AutoSettings,
} from "../../shared/automation";
import { MAX_DECIDE } from "../../shared/queue-rules";
import { BLOCKLIST_PATH, parseBlocklist } from "../../shared/removal";

const LEASE = "auto-approve";
const LEASE_MS = 5 * 60 * 1000;

export interface AutoApproveResult {
  outcome: "approved" | "skipped" | "failed";
  detail: string;
  count?: number;
  sha?: string | null;
}

const ORDER_SQL: Record<AutoSettings["order"], string> = {
  oldest: "q.first_seen_at ASC, q.id",
  newest: "q.first_seen_at DESC, q.id",
  players: "q.current_players_num DESC NULLS LAST, q.first_seen_at ASC, q.id",
};

/**
 * The WHERE clause and its bindings for "eligible now". One builder for the
 * run and for the page's preview, so what the page shows is what runs.
 */
function eligibleWhere(settings: AutoSettings, now: Date): { where: string; binds: unknown[] } {
  const cutoff = new Date(now.getTime() - settings.minAgeHours * 3_600_000).toISOString();
  const clauses = [
    "q.status = 'pending'",
    "q.is_free = 1",
    "q.app_type = 'game'",
    "q.health_status = 'ok'",
    "q.first_seen_at <= ?",
    "NOT EXISTS (SELECT 1 FROM ingest_decisions d WHERE d.appid = q.appid)",
    "NOT EXISTS (SELECT 1 FROM ingest_queue c WHERE c.appid = q.appid AND c.status = 'committed')",
  ];
  const binds: unknown[] = [cutoff];
  if (settings.sources.length) {
    const parts: string[] = [];
    for (const s of settings.sources) {
      if (s.endsWith("*")) {
        parts.push("q.source LIKE ? ESCAPE '\\'");
        binds.push(s.slice(0, -1).replace(/[\\%_]/g, (c) => "\\" + c) + "%");
      } else {
        parts.push("q.source = ?");
        binds.push(s);
      }
    }
    clauses.push(`(${parts.join(" OR ")})`);
  }
  return { where: clauses.join(" AND "), binds };
}

export async function selectCandidates(
  env: Env,
  settings: AutoSettings,
  now: Date,
  limit: number,
): Promise<(DecideRow & { source: string })[]> {
  const { where, binds } = eligibleWhere(settings, now);
  const rows = await env.DB.prepare(
    `SELECT q.id, q.appid, q.link, q.name, q.status, q.first_seen_at, q.source,
            0 AS published, 0 AS open_sibling
       FROM ingest_queue q
      WHERE ${where}
      ORDER BY ${ORDER_SQL[settings.order]}
      LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<DecideRow & { source: string }>();
  return rows.results ?? [];
}

export async function countEligible(env: Env, settings: AutoSettings, now: Date): Promise<number> {
  const { where, binds } = eligibleWhere(settings, now);
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ingest_queue q WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function recordLast(env: Env, now: Date, last: Omit<AutoLast, "at">): Promise<AutoLast | null> {
  let previous: AutoLast | null = null;
  try {
    const raw = await readState(env.DB, AUTO_LAST_KEY);
    previous = raw ? (JSON.parse(raw) as AutoLast) : null;
  } catch {
    previous = null;
  }
  await writeState(env.DB, AUTO_LAST_KEY, JSON.stringify({ at: now.toISOString(), ...last }), now);
  return previous;
}

export async function autoApprove(
  env: Env,
  deps: AdminDeps,
  opts: { manual?: boolean; actor?: string } = {},
): Promise<AutoApproveResult> {
  const stored = await readState(env.DB, AUTO_SETTINGS_KEY);
  if (stored === null) return { outcome: "skipped", detail: "state unavailable (apply migration 0002)" };
  const settings = parseSettings(stored);
  // The common case, every 15 minutes: one indexed read and nothing else.
  if (!settings.enabled && !opts.manual) return { outcome: "skipped", detail: "disabled" };

  const owner = crypto.randomUUID();
  const now = deps.now();
  const lease = await acquireLease(env.DB, LEASE, owner, LEASE_MS, now);
  if (lease === "held") return { outcome: "skipped", detail: "another run in progress" };
  if (lease === "unavailable") return { outcome: "skipped", detail: "state unavailable (apply migration 0002)" };

  let result: AutoApproveResult;
  try {
    result = await run(env, deps, settings, now, opts);
  } catch (err) {
    result = { outcome: "failed", detail: errorText(err) };
  } finally {
    await releaseLease(env.DB, LEASE, owner);
  }

  const previous = await recordLast(env, now, { ...result, manual: !!opts.manual }).catch(() => null);
  // A failure is audited once per distinct cause, not once per tick.
  if (result.outcome === "failed" && (opts.manual || previous?.outcome !== "failed" || previous.detail !== result.detail)) {
    await audit(env, opts.actor ?? AUTO_ACTOR, "auto.approve.failed", null, { detail: result.detail, manual: !!opts.manual });
  }
  return result;
}

async function run(
  env: Env,
  deps: AdminDeps,
  settings: AutoSettings,
  now: Date,
  opts: { manual?: boolean; actor?: string },
): Promise<AutoApproveResult> {
  const limit = Math.min(settings.dailyLimit, AUTO_DAILY_CEILING);
  const key = autoCountKey(now);
  const usedRaw = await readState(env.DB, key);
  if (usedRaw === null) return { outcome: "skipped", detail: "state unavailable (apply migration 0002)" };
  const used = Number(usedRaw ?? 0) || 0;
  const remaining = limit - used;
  if (remaining <= 0) return { outcome: "skipped", detail: `daily limit reached (${used}/${limit})` };

  let rows = await selectCandidates(env, settings, now, Math.min(settings.batchSize, MAX_DECIDE, remaining));
  if (!rows.length) return { outcome: "skipped", detail: "nothing eligible" };

  // Gate: the previous batch has left the queue file.
  let files: (string | null)[];
  try {
    ({ files } = await deps.readRepoFiles(env, [TEMP_INFO_PATH, BLOCKLIST_PATH]));
  } catch (err) {
    return { outcome: "skipped", detail: `GitHub unreachable: ${errorText(err)}` };
  }
  if ((files[0] ?? "").trim()) return { outcome: "skipped", detail: "the previous batch is still in scripts/temp_info.jsonl" };
  const blocked = parseBlocklist(files[1] ?? "");
  rows = rows.filter((r) => !blocked.has(r.appid));
  if (!rows.length) return { outcome: "skipped", detail: "nothing eligible" };

  // Gate: the data pipeline is idle.
  try {
    const busy = activeDataWrite(await recentRuns(env, deps));
    if (busy) return { outcome: "skipped", detail: `pipeline busy: ${busy.name || busy.file} is ${busy.status}` };
  } catch (err) {
    return { outcome: "skipped", detail: `GitHub unreachable: ${errorText(err)}` };
  }

  // Reserve the budget, then spend it.
  const total = await bumpCounter(env.DB, key, rows.length, now);
  if (total === null) return { outcome: "skipped", detail: "state unavailable (apply migration 0002)" };
  if (total > limit) {
    await bumpCounter(env.DB, key, -rows.length, now);
    return { outcome: "skipped", detail: `daily limit reached (${limit})` };
  }

  const out = await approveRows(env, deps, rows, {
    kind: "auto.approve",
    actor: opts.actor ?? AUTO_ACTOR,
    reason: opts.manual ? "run by hand from /admin/automation" : "",
    append: { auto: { dailyLimit: limit }, requireEmptyQueue: true },
    quietFailure: true,
  });
  switch (out.status) {
    case "committed":
      return { outcome: "approved", detail: `${out.decidedIds.length} approved`, count: out.decidedIds.length, sha: out.sha };
    case "busy":
      await bumpCounter(env.DB, key, -rows.length, now);
      return { outcome: "skipped", detail: "the previous batch is still in scripts/temp_info.jsonl" };
    case "commit-failed":
      await bumpCounter(env.DB, key, -rows.length, now);
      return { outcome: "failed", detail: `commit failed: ${out.message}` };
    case "desynced":
      // The commit landed: the budget stays spent.
      return { outcome: "failed", detail: `commit ${out.sha ?? "(none)"} landed but the queue was not updated: ${out.message}`, sha: out.sha };
  }
}
