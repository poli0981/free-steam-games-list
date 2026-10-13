/**
 * SQL fragments over ingest_queue that more than one module must agree on:
 * the decide handler (routes/admin.ts), the approve path (lib/approve.ts),
 * auto-approve (lib/auto-approve.ts) and the removal routes (routes/remove.ts).
 *
 * Only ever built from fixed aliases and the shared constants - never from a
 * request.
 */
import { DECIDABLE, OPEN_STATUSES, sqlList } from "../../shared/queue-rules";

/**
 * Whether the game a row names is already published, as SQL over `alias`.
 *
 * Per GAME, not per row: a committed row for the appid (reconcile saw it in
 * data/), or an approved decision (the durable record of the same fact, which
 * outlives queue history). Every decide UPDATE repeats this in its WHERE
 * clause, so a page held open across a reconcile cannot act on a game that
 * went live in the meantime. A removed game has neither (routes/remove.ts
 * rejects its rows and its decision), so it is not "published".
 */
export function publishedSql(alias: string): string {
  return `(EXISTS (SELECT 1 FROM ingest_decisions pd WHERE pd.appid = ${alias}.appid AND pd.decision = 'approved')
        OR EXISTS (SELECT 1 FROM ingest_queue pc WHERE pc.appid = ${alias}.appid AND pc.status = 'committed'))`;
}

/** Another OPEN row for the same appid (the rows uq_queue_open_appid counts). */
export function openSiblingSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM ingest_queue os WHERE os.appid = ${alias}.appid AND os.id <> ${alias}.id
                     AND os.status IN (${sqlList(OPEN_STATUSES)}))`;
}

export const DECIDABLE_SQL = sqlList(DECIDABLE);

/** A row as the decide handler and the approve path read it. */
export interface DecideRow {
  id: string;
  appid: string;
  link: string;
  name: string;
  status: string;
  first_seen_at: string;
  published: number;
  open_sibling: number;
}
