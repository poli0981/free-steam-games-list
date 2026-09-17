/**
 * Closes the loop between "approved" and "actually published".
 *
 * Approving a game commits a REQUEST to scripts/temp_info.jsonl. What happens
 * next is out of the Worker's hands: ingest_new.py re-checks the game and can
 * reject it as a duplicate, delisted, not actually free, or unreachable. So an
 * approval is not an outcome, and recording one as if it were is a real bug —
 * `/api/ingest/known` reports decided appids to the discovery sweep, so a game
 * marked decided-but-never-published would be skipped by every future sweep
 * and disappear silently.
 *
 * This reconciler is therefore the ONLY writer of ingest_decisions('approved'),
 * and it writes one only after observing the appid in the published dataset.
 *
 * It also SWEEPS: a pending, deferred or failed row whose game is already in
 * data/ is marked committed. That happens when the browser extension queues a
 * game discovery also proposed, and when an approval aged out to 'failed' (see
 * STALE_AFTER_MS) and was published afterwards anyway - before the sweep such a
 * row stayed 'failed' forever for a game that was live.
 */
import type { AdminDeps } from "./deps";
import { acquireLease, releaseLease, readState, writeState } from "./locks";

/** Bounded so one cron tick cannot run away; the next tick picks up the rest. */
const MAX_PER_RUN = 200;

/** Rows in one D1 batch. */
const BATCH = 50;

/**
 * How long an approval may sit unobserved before it is called failed.
 *
 * Deliberately generous. ingest-new.yml runs on a three-hourly cron, and it
 * shares `concurrency: {group: data-write}` with jobs that run ~115 minutes, so
 * roughly five hours can pass before the pipeline even looks at a fresh
 * approval. A tighter window would keep failing rows that were about to
 * publish; the cost of a loose one is only that a genuinely lost row takes
 * half a day to surface.
 */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** A run fetches ~6 MB; a crashed isolate's lease frees itself after this. */
const LEASE_MS = 10 * 60 * 1000;

/** admin_state key: the dataset generation the last sweep ran against. */
const WATERMARK_KEY = "reconcile.index";

/** Appids listed per outcome in the audit row. */
const AUDIT_APPIDS = 200;

export interface ReconcileResult {
  checked: number;
  published: number;
  removed: number;
  /** Approvals aged out because nothing ever observed them. */
  stale: number;
  /** Undecided or failed rows marked committed because the game is live. */
  swept: number;
  skipped?: string;
}

const empty = (skipped: string, checked = 0): ReconcileResult => ({
  checked,
  published: 0,
  removed: 0,
  stale: 0,
  swept: 0,
  skipped,
});

/**
 * appid -> when the pipeline removed it, from scripts/removed_games.jsonl.
 *
 * That file is append-only history deduped to one line per appid, and it is
 * never pruned — the oldest entries here are from March. Matching on the appid
 * alone would mean a game removed months ago for "No longer free-to-play",
 * which has since become free again and been re-approved, is marked failed the
 * instant it is approved. The timestamp is what separates "the pipeline just
 * rejected this" from "the pipeline rejected this once, long ago".
 */
function parseRemoved(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t) as { appid?: unknown; link?: unknown; removed_at?: unknown };
      // Derive the appid the way dedup_removed() does: not every line carries
      // an explicit appid field.
      let appid = typeof rec.appid === "string" ? rec.appid : "";
      if (!appid && typeof rec.link === "string") {
        appid = rec.link.match(/\/app\/(\d+)/)?.[1] ?? "";
      }
      if (!appid) continue;
      const when = typeof rec.removed_at === "string" ? Date.parse(rec.removed_at) : NaN;
      out.set(appid, Number.isNaN(when) ? 0 : when);
    } catch {
      // One malformed line must not blind the whole reconcile.
    }
  }
  return out;
}

/**
 * Every appid in the published shards.
 *
 * A regex over the canonical link rather than JSON parsing: the shards total
 * ~6 MB, and `"link": ".../app/<id>/"` is anchored by the field name, so it
 * cannot match inside a description or a note quoting a store URL.
 */
export function publishedAppids(shards: string[]): Set<string> {
  const out = new Set<string>();
  const re = /"link"\s*:\s*"https?:\/\/store\.steampowered\.com\/app\/(\d+)\//g;
  for (const text of shards) {
    for (const m of text.matchAll(re)) out.add(m[1]);
  }
  return out;
}

/**
 * The upsert that records a publication. Overwrites a 'rejected' decision:
 * the game IS in data/, which is a fact, and a stale rejection would leave the
 * admin screen offering to approve or reject a live game.
 */
function recordPublished(env: Env, appid: string, now: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO ingest_decisions (appid, decision, reason, decided_by, decided_at)
     VALUES (?1, 'approved', 'observed in data/', 'reconcile', ?2)
     ON CONFLICT(appid) DO UPDATE SET
       decision = 'approved', reason = excluded.reason,
       decided_by = excluded.decided_by, decided_at = excluded.decided_at
     WHERE ingest_decisions.decision <> 'approved'`,
  ).bind(appid, now);
}

/**
 * Per-isolate guard, still kept under the D1 lease: it makes a double click
 * within one isolate share one run instead of the second one being refused.
 */
let inFlight: Promise<ReconcileResult> | null = null;

export async function reconcileApproved(
  env: Env,
  deps: AdminDeps,
  options: { manual?: boolean } = {},
): Promise<ReconcileResult> {
  if (inFlight) return inFlight;
  inFlight = runLocked(env, deps, options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runLocked(env: Env, deps: AdminDeps, options: { manual?: boolean }): Promise<ReconcileResult> {
  const owner = crypto.randomUUID();
  const lease = await acquireLease(env.DB, "reconcile", owner, LEASE_MS, deps.now());
  // "unavailable" = migration 0002 not applied yet: run anyway, guarded only
  // per isolate, exactly as before the lease existed.
  if (lease === "held") return empty("another run in progress");
  try {
    return await runReconcile(env, deps, options, lease !== "unavailable");
  } finally {
    if (lease === "acquired") await releaseLease(env.DB, "reconcile", owner);
  }
}

async function runReconcile(
  env: Env,
  deps: AdminDeps,
  options: { manual?: boolean },
  stateAvailable: boolean,
): Promise<ReconcileResult> {
  const [approvedRes, sweepableRes] = await Promise.all([
    env.DB.prepare(
      `SELECT id, appid, decided_at FROM ingest_queue WHERE status = 'approved'
        ORDER BY decided_at ASC, id LIMIT ?`,
    )
      .bind(MAX_PER_RUN)
      .all<{ id: string; appid: string; decided_at: string | null }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ingest_queue WHERE status IN ('pending','deferred','failed')",
    ).first<{ n: number }>(),
  ]);
  const approved = approvedRes.results ?? [];
  const sweepable = sweepableRes?.n ?? 0;

  // The common case by far: nothing to promote and nothing to sweep costs two
  // indexed D1 queries and no fetch at all.
  if (!approved.length && !sweepable) return empty("nothing approved");

  const index = await deps.fetchRaw("data/index.json", 0);
  if (!index) return empty("index unreachable", approved.length);

  let shardNames: string[];
  let generation = "";
  try {
    const parsed = JSON.parse(index) as {
      last_updated?: unknown;
      files?: { name?: unknown; sha256?: unknown }[];
    };
    shardNames = (parsed.files ?? [])
      .map((f) => f?.name)
      .filter((n): n is string => typeof n === "string" && /^data_\d{3}\.jsonl$/.test(n));
    generation = JSON.stringify([parsed.last_updated, (parsed.files ?? []).map((f) => f?.sha256 ?? f?.name)]);
  } catch {
    return empty("index unparseable", approved.length);
  }
  if (!shardNames.length) return empty("no shards listed", approved.length);

  // Nothing approved, and the dataset has not changed since the last sweep:
  // there is nothing new to observe, so skip the ~6 MB fetch. A manual run
  // always looks. Without the state table there is no memory between ticks,
  // so only approvals or a manual run justify the fetch.
  if (!approved.length && !options.manual) {
    if (!stateAvailable) return empty("nothing approved");
    const last = await readState(env.DB, WATERMARK_KEY);
    if (last === null || last === generation) return empty("dataset unchanged");
  }

  const shards = await Promise.all(shardNames.map((n) => deps.fetchRaw(`data/${n}`, 0)));
  // A partial read would look exactly like "these games were never published"
  // and would strand every row it touched, so treat it as a failed tick.
  if (shards.some((s) => s === null)) return empty("shard unreachable", approved.length);
  const live = publishedAppids(shards as string[]);

  // Kept separate from the "" fallback: an unreadable removals file is not the
  // same as an empty one. Without it we cannot tell a pipeline rejection from
  // an unprocessed row, so neither of those two judgements may be made on this
  // tick — promotions still can, because those only need the shards.
  const removedText = await deps.fetchRaw("scripts/removed_games.jsonl", 0);
  const removed = removedText === null ? null : parseRemoved(removedText);

  const nowDate = deps.now();
  const nowMs = nowDate.getTime();
  const now = nowDate.toISOString();
  const writes: D1PreparedStatement[] = [];
  const outcome = { published: [] as string[], removed: [] as string[], stale: [] as string[], swept: [] as string[] };

  for (const row of approved) {
    if (live.has(row.appid)) {
      outcome.published.push(row.appid);
      writes.push(
        env.DB.prepare(
          `UPDATE ingest_queue SET status = 'committed' WHERE id = ? AND status = 'approved'`,
        ).bind(row.id),
        // Only NOW is the appid genuinely decided, and only now may
        // /api/ingest/known tell the sweep to stop offering it.
        recordPublished(env, row.appid, now),
      );
      continue;
    }

    if (removed === null) continue; // cannot judge the two cases below

    // decided_at is nullable in the schema. A row without one cannot be aged,
    // and must not be treated as infinitely old.
    const decidedMs = row.decided_at ? Date.parse(row.decided_at) : NaN;
    const removedMs = removed.get(row.appid);

    // Only a removal recorded AFTER this approval describes this approval.
    if (removedMs !== undefined && !Number.isNaN(decidedMs) && removedMs > decidedMs) {
      outcome.removed.push(row.appid);
      // Deliberately NOT written to ingest_decisions: that would hide the appid
      // from every future sweep on the strength of one bad day (a delisting, a
      // temporary outage). Left as 'failed' so it is visible in the admin queue
      // and can be re-approved.
      writes.push(
        env.DB.prepare(
          `UPDATE ingest_queue
              SET status = 'failed', reject_reason = 'rejected by ingest pipeline'
            WHERE id = ? AND status = 'approved'`,
        ).bind(row.id),
      );
      continue;
    }

    // Neither published nor rejected, long after the pipeline should have run.
    //
    // This is the escape hatch for a real hole: ingest_new.py SKIPS an entry
    // that hits a network error, writes nothing to removed_games.jsonl, and
    // then clears temp_info.jsonl regardless — so the request is gone and the
    // game is in neither file. Without ageing out, the row would sit in
    // 'approved' forever, and because /api/ingest/known counts 'approved' as
    // known, the discovery sweep would never offer that appid again. The game
    // would be permanently, silently lost. 'failed' is decidable, so the
    // reviewer can simply approve it again — which re-commits the link.
    if (!Number.isNaN(decidedMs) && nowMs - decidedMs > STALE_AFTER_MS) {
      outcome.stale.push(row.appid);
      writes.push(
        env.DB.prepare(
          `UPDATE ingest_queue
              SET status = 'failed',
                  reject_reason = 'never appeared in data/ or removed_games.jsonl - approve again to retry'
            WHERE id = ? AND status = 'approved'`,
        ).bind(row.id),
      );
    }
  }

  // The sweep. Reads every undecided row once; the published set is already
  // in memory, so this costs no further fetch.
  if (sweepable) {
    const rows = await env.DB.prepare(
      "SELECT id, appid FROM ingest_queue WHERE status IN ('pending','deferred','failed')",
    ).all<{ id: string; appid: string }>();
    const seen = new Set<string>();
    for (const row of rows.results ?? []) {
      if (!live.has(row.appid)) continue;
      writes.push(
        env.DB.prepare(
          `UPDATE ingest_queue
              SET status = 'committed', decided_by = 'reconcile', decided_at = ?,
                  reject_reason = 'observed in data/'
            WHERE id = ? AND status IN ('pending','deferred','failed')`,
        ).bind(now, row.id),
      );
      if (!seen.has(row.appid)) {
        seen.add(row.appid);
        outcome.swept.push(row.appid);
        writes.push(recordPublished(env, row.appid, now));
      }
    }
  }

  for (let i = 0; i < writes.length; i += BATCH) {
    await env.DB.batch(writes.slice(i, i + BATCH));
  }
  if (stateAvailable) await writeState(env.DB, WATERMARK_KEY, generation, nowDate);

  const result: ReconcileResult = {
    checked: approved.length,
    published: outcome.published.length,
    removed: outcome.removed.length,
    stale: outcome.stale.length,
    swept: outcome.swept.length,
  };

  if (writes.length) {
    const cap = (xs: string[]) => xs.slice(0, AUDIT_APPIDS);
    await env.DB.prepare(
      `INSERT INTO audit_log (actor, action, target, detail_json, created_at)
       VALUES ('reconcile', 'reconcile.approved', NULL, ?, ?)`,
    )
      .bind(
        JSON.stringify({
          ...result,
          appids: {
            published: cap(outcome.published),
            removed: cap(outcome.removed),
            stale: cap(outcome.stale),
            swept: cap(outcome.swept),
          },
        }),
        now,
      )
      .run();
  }

  return result;
}
