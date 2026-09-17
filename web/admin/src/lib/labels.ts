/**
 * Every sentence the admin shows about a status, a skip or a lock. English
 * only: the admin has one audience, and a translation layer would be weight
 * with no reader.
 */
import type { DecideAction, LockReason, SkipReason } from "../../../shared/queue-rules";

export const STATUS_HELP: Record<string, string> = {
  pending: "Waiting for a decision.",
  deferred: "Put aside for later. The game stays blocked from being queued again.",
  approved: "Requested for publication. Waiting for the pipeline to add it.",
  committed: "Published: the game is in the catalogue.",
  rejected: "Rejected. Reopen it from the details dialog.",
  failed: "The pipeline did not publish it, or a duplicate approval replaced it. It can be decided again.",
};

export const LOCK_HELP: Record<LockReason, string> = {
  decided: "Read-only: this row has already been decided.",
  published: "Read-only: this game is already in the catalogue.",
};

export const SKIP_TEXT: Record<SkipReason, string> = {
  "not-found": "no longer in the queue",
  "not-decidable": "already decided",
  published: "already in the catalogue",
  "open-row-exists": "another open row exists for this game",
  "duplicate-in-request": "another selected row for the same game was used",
  "no-op": "already in that state",
  "changed-concurrently": "changed by someone else first",
};

/** Why POST /reopen answered 409. */
export const REOPEN_TEXT: Record<string, string> = {
  "not-rejected": "This row is no longer rejected. Someone else has changed it.",
  published: "This game is already in the catalogue, so its rejection cannot be reopened.",
  "open-row-exists":
    "Another row for this game is still open (pending, deferred or approved) or committed. Decide that row instead.",
};

export const ACTION_LABEL: Record<DecideAction, string> = {
  approve: "Approve",
  reject: "Reject",
  defer: "Defer",
  requeue: "Back to pending",
};

export const ACTION_PAST: Record<DecideAction, string> = {
  approve: "Approved",
  reject: "Rejected",
  defer: "Deferred",
  requeue: "Moved back to pending",
};

/** What a decision does beyond the queue, stated before it is made. */
export const ACTION_CONSEQUENCE: Record<DecideAction, string> = {
  approve:
    "Commits the store links to scripts/temp_info.jsonl on main. The pipeline adds the games on its next run, and reconcile marks the rows committed once they appear in data/.",
  reject:
    "Records a rejection for each game, so discovery does not offer it again. You can reopen a rejected row later, one at a time.",
  defer: "Keeps the rows open for later. The games stay blocked from being queued again.",
  requeue: "Moves the rows back to pending.",
};

export const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "players", label: "Most players" },
  { value: "reviews", label: "Best reviews" },
  { value: "name", label: "Name" },
  { value: "decided", label: "Recently decided" },
] as const;
