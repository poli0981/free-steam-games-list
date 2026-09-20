/**
 * Builders shared by the admin handler tests and the local admin dev server:
 * an Env over SqliteD1, fake dependencies that record what they were asked to
 * do, and queue rows with sensible defaults.
 */
import type { AdminDeps } from "../lib/deps";
import type { CommitResult, FileEdit } from "../lib/git-commit";
import { DELETE_FILE } from "../lib/git-commit";
import { ADMIN_ATTRIBUTION } from "../../shared/admin-api";
import type { GameRecord } from "../lib/records";
import { SqliteD1 } from "./sqlite-d1";

export const ADMIN = { email: "reviewer@example.com", isServiceToken: false };

export function makeEnv(db = new SqliteD1()): Env & { sqlite: SqliteD1 } {
  return {
    DB: db.asD1(),
    sqlite: db,
    SITE_ORIGIN: "https://free-steam-games.win",
    IMG_TRANSFORM: "false",
    ADMIN_RETENTION_DAYS: "180",
    ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    ACCESS_AUD_ADMIN: "aud",
    ACCESS_AUD_INGEST: "aud-ingest",
  } as unknown as Env & { sqlite: SqliteD1 };
}

export interface QueueRowInput {
  id?: string;
  appid: string;
  name?: string;
  status?: string;
  first_seen_at?: string;
  decided_by?: string | null;
  decided_at?: string | null;
  reject_reason?: string | null;
}

let counter = 0;

export function insertRow(env: Env, row: QueueRowInput): string {
  const id = row.id ?? `row-${++counter}`;
  const seen = row.first_seen_at ?? `2026-09-${String(10 + (counter % 10)).padStart(2, "0")}T00:00:00Z`;
  (env as unknown as { sqlite: SqliteD1 }).sqlite.db
    .prepare(
      `INSERT INTO ingest_queue (id, appid, link, name, status, decided_by, decided_at, reject_reason,
                                 first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      row.appid,
      `https://store.steampowered.com/app/${row.appid}/`,
      row.name ?? `Game ${row.appid}`,
      row.status ?? "pending",
      row.decided_by ?? null,
      row.decided_at ?? null,
      row.reject_reason ?? null,
      seen,
      seen,
    );
  return id;
}

export function insertDecision(env: Env, appid: string, decision: "approved" | "rejected"): void {
  (env as unknown as { sqlite: SqliteD1 }).sqlite.db
    .prepare("INSERT INTO ingest_decisions (appid, decision, decided_at) VALUES (?, ?, '2026-09-01T00:00:00Z')")
    .run(appid, decision);
}

export function rowStatus(env: Env, id: string): string | undefined {
  const row = (env as unknown as { sqlite: SqliteD1 }).sqlite.db
    .prepare("SELECT status FROM ingest_queue WHERE id = ?")
    .get(id) as { status: string } | undefined;
  return row?.status;
}

export function decisionOf(env: Env, appid: string): string | undefined {
  const row = (env as unknown as { sqlite: SqliteD1 }).sqlite.db
    .prepare("SELECT decision FROM ingest_decisions WHERE appid = ?")
    .get(appid) as { decision: string } | undefined;
  return row?.decision;
}

/** A shard line for a published game. */
export function shardLine(appid: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ link: `https://store.steampowered.com/app/${appid}/`, name: `Game ${appid}`, ...extra });
}

export interface FakeRepo {
  /** Files in the fake repository, by path. */
  files: Map<string, string>;
  commits: { headline: string; body: string; additions: string[]; deletions: string[] }[];
  appended: string[][];
}

/**
 * Dependencies with an in-memory "repository" and "dataset". Nothing reaches
 * the network or GitHub.
 */
export function fakeDeps(options: {
  records?: Record<string, GameRecord>;
  raw?: Record<string, string>;
  failCommit?: string;
  now?: Date;
  gh?: AdminDeps["gh"];
} = {}): AdminDeps & { repo: FakeRepo } {
  const repo: FakeRepo = { files: new Map(), commits: [], appended: [] };
  let sha = 0;
  const now = options.now ?? new Date("2026-09-17T12:00:00Z");

  const appendLinks = async (_env: Env, links: string[], reason = ""): Promise<CommitResult> => {
    if (options.failCommit) throw new Error(options.failCommit);
    const queued = new Set(repo.appended.flat());
    const fresh = [...new Set(links)].filter((l) => !queued.has(l));
    const skipped = [...new Set(links)].filter((l) => queued.has(l));
    if (!fresh.length) return { sha: null, appended: 0, skipped };
    repo.appended.push(fresh);
    repo.commits.push({ headline: `queue: ${fresh.length}`, body: `by ${ADMIN_ATTRIBUTION} ${reason}`, additions: ["scripts/temp_info.jsonl"], deletions: [] });
    return { sha: `sha${++sha}`.padEnd(40, "0"), appended: fresh.length, skipped };
  };

  const commitFiles = async (_env: Env, edits: FileEdit[], headline: string, body: string) => {
    if (options.failCommit) throw new Error(options.failCommit);
    const additions: string[] = [];
    const deletions: string[] = [];
    for (const e of edits) {
      const exists = repo.files.has(e.path);
      const next = e.build(repo.files.get(e.path) ?? "", exists);
      if (next === DELETE_FILE) {
        if (exists) {
          repo.files.delete(e.path);
          deletions.push(e.path);
        }
      } else if (next !== null && next !== repo.files.get(e.path)) {
        repo.files.set(e.path, next);
        additions.push(e.path);
      }
    }
    if (!additions.length && !deletions.length) return null;
    repo.commits.push({ headline, body, additions, deletions });
    return `sha${++sha}`.padEnd(40, "0");
  };

  return {
    repo,
    appendLinks: appendLinks as AdminDeps["appendLinks"],
    commitFiles: commitFiles as AdminDeps["commitFiles"],
    gh: options.gh ?? (async () => new Response("[]", { status: 200 })),
    findRecord: async (appid) => options.records?.[appid] ?? null,
    findOverride: async (appid) => {
      const text = repo.files.get(`data/overrides/${appid}.json`);
      return text ? (JSON.parse(text) as Record<string, unknown>) : null;
    },
    genreCounts: async () => [],
    listByGenre: async () => ({ total: 0, items: [] }),
    fetchRaw: async (path) => options.raw?.[path] ?? null,
    now: () => now,
  };
}

/** Call a handler with a JSON body the way the Worker would route it. */
export function request(method: string, path: string, body?: unknown): { request: Request; url: URL } {
  const url = new URL(`https://free-steam-games.win${path}`);
  return {
    url,
    request: new Request(url, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    }),
  };
}
