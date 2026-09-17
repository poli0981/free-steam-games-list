/**
 * The review queue's rules, in ONE place, imported by both the Worker
 * (worker/routes/admin.ts) and the admin SPA (admin/src).
 *
 * The old admin page carried its own copy of DECIDABLE as an inline-script
 * literal, and a test existed only to keep the two strings equal. A shared
 * module removes the second copy instead of guarding it.
 *
 * Pure: no DOM, no Env, no I/O. queue-rules.test.ts also parses
 * worker/migrations/0001_init.sql and fails if the statuses or the open-row
 * index drift from the constants here.
 */

/** Every value ingest_queue.status may hold (the CHECK constraint). */
export const QUEUE_STATUSES = ["pending", "deferred", "approved", "committed", "rejected", "failed"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/**
 * Statuses a row may be decided FROM.
 *
 *   approved   the approval is already committed to Git as a request
 *   committed  the game was observed in data/ - it is published
 *   rejected   final; reopened explicitly, one row at a time, never in bulk
 */
export const DECIDABLE = ["pending", "deferred", "failed"] as const satisfies readonly QueueStatus[];

/** Statuses covered by uq_queue_open_appid: at most one such row per appid. */
export const OPEN_STATUSES = ["pending", "deferred", "approved"] as const satisfies readonly QueueStatus[];

/** Rows one decision may touch: bounds the D1 batch, the commit, and a mis-click. */
export const MAX_DECIDE = 100;

/** Games one override commit may change. */
export const MAX_EDIT = 10;

export const DECIDE_ACTIONS = ["approve", "reject", "defer", "requeue"] as const;
export type DecideAction = (typeof DECIDE_ACTIONS)[number];

/** Why a row named in a decision was not decided. Reported back, never silent. */
export type SkipReason =
  /** No row has that id. */
  | "not-found"
  /** approved, committed or rejected. */
  | "not-decidable"
  /** The game is already in the catalogue (a committed row, or an approved decision). */
  | "published"
  /** Another open row exists for the appid, and this move would collide with it. */
  | "open-row-exists"
  /** The request named two rows for one appid; the newer one was used. */
  | "duplicate-in-request"
  /** Deferring a deferred row, or requeueing a pending one. */
  | "no-op"
  /** Decidable when read, changed by someone else before the write. */
  | "changed-concurrently";

export interface SkippedRow {
  id: string;
  appid: string | null;
  reason: SkipReason;
}

export type LockReason = "decided" | "published";

export function isDecidable(status: string): boolean {
  return (DECIDABLE as readonly string[]).includes(status);
}

/**
 * Why a row is read-only, or null when a reviewer may act on it.
 *
 * `published` is per GAME, not per row: one appid can have several rows, and a
 * pending or failed row for a game that is already live must not be approved
 * again (it would re-queue a published link) or rejected (it would record a
 * rejection for a game the catalogue carries).
 */
export function lockReason(row: { status: string; published?: boolean | number | null }): LockReason | null {
  if (!isDecidable(row.status)) return "decided";
  if (row.published) return "published";
  return null;
}

/** Whether the row gets a selection checkbox. */
export function isSelectable(row: { status: string; published?: boolean | number | null }): boolean {
  return lockReason(row) === null;
}

/** A move that would leave the row where it is. */
export function isNoOp(action: DecideAction, status: string): boolean {
  return (action === "defer" && status === "deferred") || (action === "requeue" && status === "pending");
}

/** The actions that make sense for one selectable row. */
export function allowedActions(row: { status: string; published?: boolean | number | null }): DecideAction[] {
  if (lockReason(row)) return [];
  return DECIDE_ACTIONS.filter((a) => !isNoOp(a, row.status));
}

/**
 * A closed tuple as SQL string literals: `'pending','deferred'`.
 *
 * Only ever for the constants above - values that are fixed at build time and
 * lowercase words - so a status list can appear in a WHERE clause without
 * binding one parameter per status. Anything else throws.
 */
export function sqlList(values: readonly string[]): string {
  for (const v of values) {
    if (!/^[a-z]+$/.test(v)) throw new Error(`sqlList: refusing ${JSON.stringify(v)}`);
  }
  return values.map((v) => `'${v}'`).join(",");
}
