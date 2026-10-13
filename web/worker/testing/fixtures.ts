/**
 * Builders shared by the admin handler tests and the local admin dev server:
 * an Env over SqliteD1, fake dependencies that record what they were asked to
 * do, and queue rows with sensible defaults.
 */
import type { AdminDeps } from "../lib/deps";
import type { AppendRequest, CommitResult, FileEdit } from "../lib/git-commit";
import { DELETE_FILE, TEMP_INFO_PATH } from "../lib/git-commit";
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
  /** Left at the schema defaults unless given (auto-approve filters on them). */
  source?: string;
  app_type?: string;
  is_free?: 0 | 1;
  health_status?: string;
  current_players_num?: number | null;
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
  const extra = (["source", "app_type", "is_free", "health_status", "current_players_num"] as const).filter(
    (k) => row[k] !== undefined,
  );
  if (extra.length) {
    (env as unknown as { sqlite: SqliteD1 }).sqlite.db
      .prepare(`UPDATE ingest_queue SET ${extra.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .run(...extra.map((k) => row[k] ?? null), id);
  }
  return id;
}

/** A pending row auto-approve may take: a free game, healthy, from `source`. */
export function insertCandidate(
  env: Env,
  appid: string,
  source = "backfill:2024Q3",
  first_seen_at = "2026-09-01T00:00:00Z",
): string {
  return insertRow(env, { appid, source, app_type: "game", is_free: 1, health_status: "ok", first_seen_at });
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

  // The queue file lives in repo.files like any other, so a test (or the
  // mock server) can seed it, empty it the way ingest_new.py does, or read
  // what an approval appended.
  const appendLinks = async (_env: Env, links: string[], request: AppendRequest = {}): Promise<CommitResult> => {
    if (options.failCommit) throw new Error(options.failCommit);
    const text = repo.files.get(TEMP_INFO_PATH) ?? "";
    if (request.requireEmptyQueue && text.trim()) return { sha: null, appended: 0, skipped: [], busy: true };
    const queued = new Set(repo.appended.flat());
    for (const line of text.split("\n")) {
      try {
        const link = (JSON.parse(line) as { link?: unknown }).link;
        if (typeof link === "string") queued.add(link);
      } catch {
        /* blank or foreign line */
      }
    }
    const fresh = [...new Set(links)].filter((l) => !queued.has(l));
    const skipped = [...new Set(links)].filter((l) => queued.has(l));
    if (!fresh.length) return { sha: null, appended: 0, skipped };
    repo.appended.push(fresh);
    repo.files.set(TEMP_INFO_PATH, text + fresh.map((l) => JSON.stringify({ link: l }) + "\n").join(""));
    const kind = request.auto ? "auto-approved" : "approved";
    repo.commits.push({
      headline: `queue: ${fresh.length} ${kind}`,
      body: `by ${ADMIN_ATTRIBUTION} ${request.reason ?? ""}`,
      additions: [TEMP_INFO_PATH],
      deletions: [],
    });
    return { sha: `sha${++sha}`.padEnd(40, "0"), appended: fresh.length, skipped };
  };

  const readRepoFiles = async (_env: Env, paths: string[]) => ({
    head: `head${sha}`,
    files: paths.map((p) => (repo.files.has(p) ? repo.files.get(p)! : (options.raw?.[p] ?? null))),
  });

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
    readRepoFiles: readRepoFiles as AdminDeps["readRepoFiles"],
    gh: options.gh ?? (async () => new Response("[]", { status: 200 })),
    findRecord: async (appid) => options.records?.[appid] ?? null,
    findOverride: async (appid) => {
      const text = repo.files.get(`data/overrides/${appid}.json`);
      return text ? (JSON.parse(text) as Record<string, unknown>) : null;
    },
    genreCounts: async () => [],
    listByGenre: async () => ({ total: 0, items: [] }),
    // What the fake repository holds wins over the seeded raw files, so a
    // commit a test just made is what the next read sees.
    fetchRaw: async (path) => repo.files.get(path) ?? options.raw?.[path] ?? null,
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
