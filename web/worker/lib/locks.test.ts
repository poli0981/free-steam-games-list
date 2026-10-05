import { describe, expect, it } from "vitest";
import { acquireLease, bumpCounter, readLease, readState, releaseLease, writeState } from "./locks";
import { pruneAdminHistory, retentionDays, isPruneTick } from "./prune";
import { makeEnv } from "../testing/fixtures";

const T0 = new Date("2026-09-17T00:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

describe("leases", () => {
  it("one holder at a time, until release or expiry", async () => {
    const { DB } = makeEnv();
    expect(await acquireLease(DB, "job", "a", 60_000, T0)).toBe("acquired");
    expect(await acquireLease(DB, "job", "b", 60_000, later(1_000))).toBe("held");
    expect((await readLease(DB, "job"))?.owner).toBe("a");

    // Someone else's release does nothing.
    await releaseLease(DB, "job", "b");
    expect(await acquireLease(DB, "job", "b", 60_000, later(2_000))).toBe("held");

    // An expired lease is taken over (a crashed isolate never releases).
    expect(await acquireLease(DB, "job", "b", 60_000, later(61_000))).toBe("acquired");
    await releaseLease(DB, "job", "b");
    expect(await readLease(DB, "job")).toBeNull();
  });

  it("reports unavailable instead of throwing when the table is missing", async () => {
    const env = makeEnv();
    env.sqlite.db.exec("DROP TABLE admin_locks; DROP TABLE admin_state;");
    expect(await acquireLease(env.DB, "job", "a", 1_000, T0)).toBe("unavailable");
    await expect(releaseLease(env.DB, "job", "a")).resolves.toBeUndefined();
    expect(await readState(env.DB, "k")).toBeNull();
    await expect(writeState(env.DB, "k", "v", T0)).resolves.toBeUndefined();
  });

  it("state round-trips", async () => {
    const { DB } = makeEnv();
    expect(await readState(DB, "k")).toBeUndefined();
    await writeState(DB, "k", "v1", T0);
    await writeState(DB, "k", "v2", later(1));
    expect(await readState(DB, "k")).toBe("v2");
  });
});

describe("counters", () => {
  it("bumpCounter starts at the increment and adds atomically", async () => {
    const { DB } = makeEnv();
    expect(await bumpCounter(DB, "c", 2, T0)).toBe(2);
    expect(await bumpCounter(DB, "c", 2, later(1))).toBe(4);
    expect(await bumpCounter(DB, "c", 1, later(2))).toBe(5);
    // Readable as ordinary state, which is how img-mint reads its budget.
    expect(await readState(DB, "c")).toBe("5");
  });

  it("continues from a value written as state", async () => {
    const { DB } = makeEnv();
    await writeState(DB, "c", "20000", T0);
    expect(await bumpCounter(DB, "c", 2, later(1))).toBe(20002);
  });

  it("returns null, not a number, when the table is missing", async () => {
    const env = makeEnv();
    env.sqlite.db.exec("DROP TABLE admin_state;");
    expect(await bumpCounter(env.DB, "c", 1, T0)).toBeNull();
  });
});

describe("retention", () => {
  it("deletes audit and job rows older than the window, and records that it did", async () => {
    const env = makeEnv();
    const insertAudit = env.sqlite.db.prepare(
      "INSERT INTO audit_log (actor, action, target, detail_json, created_at) VALUES ('x', 'ping', NULL, '{}', ?)",
    );
    insertAudit.run("2026-01-01T00:00:00Z");
    insertAudit.run("2026-09-01T00:00:00Z");
    env.sqlite.db
      .prepare("INSERT INTO commit_jobs (id, kind, status, target_path, created_at) VALUES ('old', 'approve', 'committed', 'x', '2025-12-01T00:00:00Z')")
      .run();

    const out = await pruneAdminHistory(env, T0);
    expect(out).toMatchObject({ audit: 1, jobs: 1 });
    const actions = env.sqlite.db.prepare("SELECT action FROM audit_log ORDER BY id").all() as any[];
    expect(actions.map((a) => a.action)).toEqual(["ping", "admin.prune"]);
  });

  it("never lets a bad value shrink the window below a week", () => {
    expect(retentionDays({ ADMIN_RETENTION_DAYS: "180" } as Env)).toBe(180);
    expect(retentionDays({ ADMIN_RETENTION_DAYS: "0" } as unknown as Env)).toBe(180);
    expect(retentionDays({ ADMIN_RETENTION_DAYS: "abc" } as unknown as Env)).toBe(180);
    expect(retentionDays({ ADMIN_RETENTION_DAYS: "30" } as unknown as Env)).toBe(30);
  });

  it("runs once a day", () => {
    expect(isPruneTick(new Date("2026-09-17T03:00:00Z"))).toBe(true);
    expect(isPruneTick(new Date("2026-09-17T03:15:00Z"))).toBe(false);
    expect(isPruneTick(new Date("2026-09-17T04:00:00Z"))).toBe(false);
  });
});
