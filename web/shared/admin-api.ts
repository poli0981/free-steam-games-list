/**
 * Response shapes of /admin/api/*, as the admin SPA consumes them.
 *
 * Types only. The handlers in worker/routes/admin.ts and edit.ts build these
 * objects; when a handler's response changes, change the matching type here
 * and svelte-check points at every screen that reads it.
 */
import type { DecideAction, QueueStatus, SkippedRow } from "./queue-rules";
import type { AutoLast, AutoSettings } from "./automation";
import type { QualityCheck } from "./quality";
import type { BlocklistEntry } from "./removal";

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
 * Every commit_jobs.kind the Worker writes - the Jobs page's filter. A test
 * (admin-api.test.ts) reads worker/ and fails on a kind missing here.
 */
export const JOB_KINDS = ["approve", "auto.approve", "override", "override.delete", "remove", "restore"] as const;

/**
 * Every audit_log.action the Worker writes - the Audit page's filter. Same
 * test. A filter, not a validator: the server checks only the shape.
 */
export const AUDIT_ACTIONS = [
  "approve",
  "approve.failed",
  "approve.desynced",
  "auto.approve",
  "auto.approve.failed",
  "auto.approve.desynced",
  "automation.settings",
  "reject",
  "defer",
  "requeue",
  "reopen",
  "remove",
  "remove.failed",
  "remove.desynced",
  "restore",
  "restore.failed",
  "restore.desynced",
  "reconcile.manual",
  "reconcile.approved",
  "override",
  "override.failed",
  "override.delete",
  "override.delete.failed",
  "ingest.candidates",
  "admin.prune",
  "ping",
] as const;

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

/**
 * What /admin writes into Git where a person would otherwise be named.
 *
 * Commit bodies and `data/overrides/<appid>.json` are public forever; the
 * reviewer's Cloudflare Access address is not something to publish with every
 * approval. D1 still records the real identity (`audit_log.actor`,
 * `ingest_queue.decided_by`, `ingest_decisions.decided_by`,
 * `commit_jobs.requested_by`) - 0001_init.sql calls that deliberate and the
 * audit view filters on it - so nothing forensic is lost, and the Git AUTHOR
 * was already the app's own bot identity.
 */
export const ADMIN_ATTRIBUTION = "admin";

export interface OverrideEntry {
  value: unknown;
  was: unknown;
  /** Always ADMIN_ATTRIBUTION for anything /admin writes. Informational:
   *  scripts/core/overrides.py reads only `value` and `was`. */
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

// ── Removal (worker/routes/remove.ts) ──────────────────────────────────────

export interface CatalogueGameSummary {
  appid: string;
  name: string;
  header_image: string;
  release_date: string;
  is_dead: boolean;
  status: string;
}

export interface CatalogueSearchResponse {
  q: string;
  total: number;
  verified: boolean;
  items: (CatalogueGameSummary & { blocked: BlocklistEntry | null })[];
}

export interface CataloguePreviewResponse {
  verified: boolean;
  items: { appid: string; found: boolean; game: CatalogueGameSummary | null; blocked: BlocklistEntry | null }[];
}

export interface RemoveResponse {
  removed: string[];
  repaired: string[];
  skipped: { appid: string; reason: "not-in-catalogue" | "already-removed" }[];
  commit: string | null;
  job: string | null;
}

interface RemovedItem extends BlocklistEntry {
  /** Still in data/ - waiting for the pipeline. null when the catalogue could not be read. */
  inCatalogue: boolean | null;
  decision: { decision: string; reason: string | null } | null;
}

export interface RemovedResponse {
  total: number;
  items: RemovedItem[];
}

export interface RemovedSummary {
  total: number;
  pending: number | null;
}

export interface RestoreResponse {
  restored: string;
  commit: string | null;
  job: string;
}

// ── Auto-approve (worker/routes/automation.ts) ─────────────────────────────

export interface AutomationResponse {
  settings: AutoSettings;
  defaults: AutoSettings;
  ceiling: number;
  maxBatch: number;
  stateAvailable: boolean;
  today: { date: string; used: number; limit: number };
  last: AutoLast | null;
  eligible: number;
  preview: { id: string; appid: string; name: string; source: string; first_seen_at: string }[];
  sources: { source: string; pending: number; failed: number; total: number }[];
  inFlight: number;
  history: AuditEntry[];
}

export interface AutoRunResponse {
  outcome: "approved" | "skipped" | "failed";
  detail: string;
  count?: number;
  sha?: string | null;
}

// ── Pipeline and quality (worker/routes/pipeline.ts, quality.ts) ──────────

export interface RunSummary {
  file: string;
  name: string;
  status: string;
  conclusion: string | null;
  event: string;
  title: string;
  created_at: string;
  run_started_at: string | null;
  updated_at: string;
  html_url: string;
  run_number: number;
}

export interface PipelineResponse {
  fetchedAt: string;
  workflows: { file: string; label: string; dataWrite: boolean; latest: RunSummary | null; recent: RunSummary[] }[];
  active: RunSummary[];
  queue: { tempInfo: number | null; blocklist: number | null };
}

export interface QualitySummaryResponse {
  total: number;
  verified: boolean;
  counts: Record<QualityCheck, number>;
}

export interface QualityListResponse {
  check: QualityCheck;
  total: number;
  limit: number;
  offset: number;
  items: { appid: string; name: string; header_image: string; release_date: string; type_game: string; genre: string; issues: QualityCheck[] }[];
}
