/**
 * Response shapes of /api/admin/*, as the admin SPA consumes them.
 *
 * Types only. The handlers in worker/routes/admin.ts and edit.ts build these
 * objects; when a handler's response changes, change the matching type here
 * and svelte-check points at every screen that reads it.
 */
import type { DecideAction, QueueStatus, SkippedRow } from "./queue-rules";

export interface QueueItem {
  id: string;
  appid: string;
  link: string;
  name: string;
  header_image: string;
  release_date: string;
  app_type: string;
  is_free: number;
  health_status: string;
  reviews_raw: string;
  reviews_pct: number | null;
  current_players_raw: string;
  current_players_num: number | null;
  source: string;
  status: QueueStatus;
  decided_by: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  /** The GAME is already in the catalogue (per appid, not per row). */
  published: boolean;
}

export interface QueueResponse {
  status: QueueStatus | "all";
  offset: number;
  limit: number;
  q: string;
  sort: string;
  total: number;
  count: number;
  items: QueueItem[];
  maxDecide: number;
}

export interface StatsResponse {
  queue: Partial<Record<QueueStatus, number>>;
  commits: Record<string, number>;
}

export interface Candidate {
  id: string;
  appid: string;
  link: string;
  name: string;
  header_image: string;
  status: QueueStatus;
  reject_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  payload_json: string;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  health_status: string;
  app_type: string;
  is_free: number;
  source: string;
  published: boolean;
  decision: { decision: "approved" | "rejected"; reason: string | null; decided_by: string | null; decided_at: string } | null;
  siblings: {
    id: string;
    status: QueueStatus;
    reject_reason: string | null;
    decided_by: string | null;
    decided_at: string | null;
    first_seen_at: string;
  }[];
}

export interface DecideResponse {
  action: DecideAction;
  decided: number;
  decidedIds: string[];
  skipped: SkippedRow[];
  commit?: string | null;
  appended?: number;
  already_queued?: number;
}

export interface ReopenResponse {
  reopened: string;
  appid: string | null;
}

export interface ReconcileResponse {
  checked: number;
  published: number;
  removed: number;
  stale: number;
  swept: number;
  skipped?: string;
}

export interface CommitJob {
  id: string;
  kind: string;
  status: "pending" | "committed" | "conflict" | "failed";
  target_path: string;
  commit_sha: string | null;
  error: string | null;
  requested_by: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  detail_json: string;
  created_at: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * The D1 migrations this build expects, by file name, so the health page can
 * name the ones not applied yet. admin-api.test.ts holds it equal to
 * worker/migrations/.
 */
export const ADMIN_MIGRATIONS = ["0001_init.sql", "0002_admin_state.sql"] as const;

export interface HealthResponse {
  ok: boolean;
  actor: string;
  retentionDays: number;
  d1?: "ok" | "error";
  github?: string;
  queue?: Partial<Record<QueueStatus, number>>;
  migrations?: string[] | null;
  lock?: { owner: string; expires_at: string } | null;
}

export interface MeResponse {
  email: string;
  isServiceToken: boolean;
}

export const MANUAL_FIELDS = [
  "genre",
  "type_game",
  "safe",
  "anti_cheat",
  "is_kernel_ac",
  "anti_cheat_note",
  "notes",
] as const;
export type ManualField = (typeof MANUAL_FIELDS)[number];

export interface OverrideEntry {
  value: unknown;
  was: unknown;
  set_by?: string;
  set_at?: string;
  reason?: string;
  retired_by?: string;
  retired_at?: string;
}

export interface GameResponse {
  appid: string;
  link: string;
  name: string;
  header_image: string;
  release_date: string;
  status: string;
  is_dead: boolean;
  fields: Record<ManualField, unknown>;
  override: { fields?: Record<string, OverrideEntry>; retired?: Record<string, OverrideEntry> } | null;
  deletable: { ok: boolean; reason: string };
}

export interface GenresResponse {
  genres: { genre: string; count: number }[];
}

export interface ByGenreResponse {
  genre: string;
  limit: number;
  offset: number;
  total: number;
  items: { appid: string; name: string; genre: string; header_image: string; release_date: string }[];
}

export interface EditResponse {
  appids: string[];
  commit: string | null;
  job: string;
  set?: string[];
  retired?: string[];
  deleted?: boolean;
  applied?: boolean;
}
