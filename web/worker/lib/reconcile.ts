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
 */

const RAW_BASE =
  "https://raw.githubusercontent.com/poli0981/free-steam-games-list/main";

/** Bounded so one cron tick cannot run away; the next tick picks up the rest. */
const MAX_PER_RUN = 200;

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

interface IndexFile {
  files?: { name?: unknown }[];
}

async function fetchText(path: string): Promise<string | null> {
  // cacheTtl 0: this is the freshness check itself. A cached shard would keep
  // reporting a game as unpublished after it landed, and the row would sit in
  // 'approved' until the cache expired.
  const res = await fetch(`${RAW_BASE}/${path}`, {
    cf: { cacheTtl: 0 },
    headers: { Accept: "text/plain, application/json, */*" },
  });
  return res.ok ? await res.text() : null;
}

export interface ReconcileResult {
  checked: number;
  published: number;
  removed: number;
  /** Approvals aged out because nothing ever observed them. */
  stale: number;
  skipped?: string;
}

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
 * Promote 'approved' rows that have since appeared in the dataset.
 *
 * Substring search rather than JSON parsing: the shards total ~6 MB, and
 * `"/app/<id>/"` is anchored on both sides by the canonical link format, so it
 * cannot collide with a longer appid or match inside a description.
 */
export async function reconcileApproved(env: Env): Promise<ReconcileResult> {
  const open = await env.DB.prepare(
    `SELECT id, appid, decided_at FROM ingest_queue WHERE status = 'approved'
      ORDER BY decided_at ASC, id LIMIT ?`,
  )
    .bind(MAX_PER_RUN)
    .all<{ id: string; appid: string; decided_at: string | null }>();

  const rows = open.results ?? [];
  // The common case by far. Returning before any fetch keeps the cron
  // essentially free on the many ticks where nothing is awaiting publication.
  if (!rows.length) {
    return { checked: 0, published: 0, removed: 0, stale: 0, skipped: "nothing approved" };
  }

  const bail = (skipped: string): ReconcileResult => ({
    checked: rows.length, published: 0, removed: 0, stale: 0, skipped,
  });

  const index = await fetchText("data/index.json");
  if (!index) return bail("index unreachable");

  let shardNames: string[];
  try {
    const parsed = JSON.parse(index) as IndexFile;
    shardNames = (parsed.files ?? [])
      .map((f) => f?.name)
      .filter((n): n is string => typeof n === "string" && /^data_\d{3}\.jsonl$/.test(n));
  } catch {
    return bail("index unparseable");
  }
  if (!shardNames.length) return bail("no shards listed");

  const shards = await Promise.all(shardNames.map((n) => fetchText(`data/${n}`)));
  // A partial read would look exactly like "these games were never published"
  // and would strand every row it touched, so treat it as a failed tick.
  if (shards.some((s) => s === null)) return bail("shard unreachable");

  // Kept separate from the "" fallback: an unreadable removals file is not the
  // same as an empty one. Without it we cannot tell a pipeline rejection from
  // an unprocessed row, so neither of those two judgements may be made on this
  // tick — promotions still can, because those only need the shards.
  const removedText = await fetchText("scripts/removed_games.jsonl");
  const removed = removedText === null ? null : parseRemoved(removedText);

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const writes: D1PreparedStatement[] = [];
  let published = 0;
  let rejected = 0;
  let stale = 0;

  for (const row of rows) {
    const needle = `/app/${row.appid}/`;

    if (shards.some((s) => s!.includes(needle))) {
      published++;
      writes.push(
        env.DB.prepare(
          `UPDATE ingest_queue SET status = 'committed' WHERE id = ? AND status = 'approved'`,
        ).bind(row.id),
        // Only NOW is the appid genuinely decided, and only now may
        // /api/ingest/known tell the sweep to stop offering it.
        env.DB.prepare(
          `INSERT INTO ingest_decisions (appid, decision, reason, decided_by, decided_at)
           VALUES (?, 'approved', 'observed in data/', 'reconcile', ?)
           ON CONFLICT(appid) DO NOTHING`,
        ).bind(row.appid, now),
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
      rejected++;
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
      stale++;
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

  if (writes.length) {
    await env.DB.batch(writes);
    await env.DB.prepare(
      `INSERT INTO audit_log (actor, action, target, detail_json, created_at)
       VALUES ('reconcile', 'reconcile.approved', NULL, ?, ?)`,
    )
      .bind(
        JSON.stringify({ checked: rows.length, published, removed: rejected, stale }),
        now,
      )
      .run();
  }

  return { checked: rows.length, published, removed: rejected, stale };
}
