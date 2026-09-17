/**
 * An in-memory D1 for tests and for `npm run dev:admin`, over node:sqlite.
 *
 * It runs the REAL migrations from worker/migrations, so a handler under test
 * meets the same CHECK constraints, STRICT typing and partial unique index as
 * production - the index is exactly what the admin decide/reopen guards exist
 * to respect, and a mock that ignored it would prove nothing.
 *
 * Only the surface the Worker uses is implemented: prepare/bind, first, all,
 * run (with meta.changes), batch (one transaction, rolled back on any throw,
 * as D1 does) and exec. Node-only: excluded from tsconfig.worker.json.
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Param = string | number | bigint | null | Uint8Array;

function normalise(params: unknown[]): Param[] {
  return params.map((p) => {
    if (p === undefined) throw new Error("D1_TYPE_ERROR: undefined is not a supported bind value");
    if (typeof p === "boolean") return p ? 1 : 0;
    return p as Param;
  });
}

/** SELECT-shaped statements return rows; everything else reports changes. */
function isReader(sql: string): boolean {
  const s = sql.trim().toUpperCase();
  return s.startsWith("SELECT") || s.startsWith("WITH") || /\bRETURNING\b/.test(s);
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...normalise(this.params)) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = Record<string, unknown>>() {
    return this.execute<T>(true);
  }

  async run() {
    return this.execute(false);
  }

  /** What batch() needs from each statement. */
  execute<T>(preferRows: boolean) {
    const stmt = this.db.prepare(this.sql);
    if (preferRows || isReader(this.sql)) {
      const results = stmt.all(...normalise(this.params)) as T[];
      return { success: true, results, meta: { changes: 0, last_row_id: 0, rows_read: results.length, rows_written: 0 } };
    }
    const info = stmt.run(...normalise(this.params));
    return {
      success: true,
      results: [] as T[],
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid), rows_read: 0, rows_written: Number(info.changes) },
    };
  }
}

export class SqliteD1 {
  readonly db: DatabaseSync;

  constructor(options: { migrations?: boolean } = {}) {
    this.db = new DatabaseSync(":memory:");
    if (options.migrations !== false) this.applyMigrations();
  }

  /** The migrations directory, applied in order and recorded like wrangler does. */
  applyMigrations(dir = join(process.cwd(), "worker", "migrations")): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    );
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
      this.db.exec(readFileSync(join(dir, name), "utf-8"));
      this.db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
    }
  }

  prepare(sql: string): Statement {
    return new Statement(this.db, sql);
  }

  async batch(statements: Statement[]) {
    this.db.exec("BEGIN");
    try {
      const out = statements.map((s) => s.execute(false));
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async exec(sql: string) {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }

  /** Typed as D1Database for handlers; the subset above is what they use. */
  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}
