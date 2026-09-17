/**
 * Cross-isolate leases and small persisted state, both in D1
 * (migrations/0002_admin_state.sql).
 *
 * TOLERANT OF THE MIGRATION NOT BEING APPLIED YET. D1 migrations are applied
 * by hand (docs/ADMIN.md), so for some window the deployed Worker may be newer
 * than the database. A missing table is reported as "unavailable" rather than
 * thrown, and every caller has a fallback - so deploy order never matters.
 */

export type LeaseResult = "acquired" | "held" | "unavailable";

function missingTable(err: unknown): boolean {
  return /no such table/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * Take the named lease for `ttlMs`, unless someone else holds an unexpired one.
 *
 * One statement, so there is no read-then-write gap: the upsert only
 * overwrites a lease whose expiry has passed, and `changes` says whether it
 * did.
 */
export async function acquireLease(
  db: D1Database,
  name: string,
  owner: string,
  ttlMs: number,
  now: Date,
): Promise<LeaseResult> {
  const expires = new Date(now.getTime() + ttlMs).toISOString();
  try {
    const res = await db
      .prepare(
        `INSERT INTO admin_locks (name, owner, expires_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
         WHERE admin_locks.expires_at < ?4`,
      )
      .bind(name, owner, expires, now.toISOString())
      .run();
    return res.meta.changes === 1 ? "acquired" : "held";
  } catch (err) {
    if (missingTable(err)) {
      console.warn("locks: admin_locks is missing - apply migration 0002");
      return "unavailable";
    }
    throw err;
  }
}

/** Release a lease this owner holds. Someone else's lease is left alone. */
export async function releaseLease(db: D1Database, name: string, owner: string): Promise<void> {
  try {
    await db.prepare("DELETE FROM admin_locks WHERE name = ? AND owner = ?").bind(name, owner).run();
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
}

/** The current lease, for /api/admin/health. null when free or unavailable. */
export async function readLease(
  db: D1Database,
  name: string,
): Promise<{ owner: string; expires_at: string } | null> {
  try {
    return await db
      .prepare("SELECT owner, expires_at FROM admin_locks WHERE name = ?")
      .bind(name)
      .first<{ owner: string; expires_at: string }>();
  } catch (err) {
    if (missingTable(err)) return null;
    throw err;
  }
}

/** A persisted value, or undefined when unset. null when the table is missing. */
export async function readState(db: D1Database, key: string): Promise<string | undefined | null> {
  try {
    const row = await db.prepare("SELECT value FROM admin_state WHERE key = ?").bind(key).first<{ value: string }>();
    return row?.value;
  } catch (err) {
    if (missingTable(err)) return null;
    throw err;
  }
}

export async function writeState(db: D1Database, key: string, value: string, now: Date): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO admin_state (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(key, value, now.toISOString())
      .run();
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
}
