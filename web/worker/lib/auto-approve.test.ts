/**
 * Auto-approve against the real schema, with GitHub faked: every gate, the
 * budget, and that a batch goes through the same approve path as a reviewer's.
 */
import { describe, expect, it } from "vitest";
import { autoApprove, selectCandidates } from "./auto-approve";
import { acquireLease, readState, writeState } from "./locks";
import { fakeDeps, insertCandidate, insertDecision, insertRow, makeEnv, rowStatus } from "../testing/fixtures";
import { AUTO_DEFAULTS, AUTO_LAST_KEY, AUTO_SETTINGS_KEY, autoCountKey, type AutoSettings } from "../../shared/automation";
import { makeEntry, serializeEntry } from "../../shared/removal";

const NOW = new Date("2026-09-17T12:00:00Z");
const QUEUE = "scripts/temp_info.jsonl";

async function enable(env: Env, settings: Partial<AutoSettings> = {}) {
  await writeState(env.DB, AUTO_SETTINGS_KEY, JSON.stringify({ ...AUTO_DEFAULTS, enabled: true, ...settings }), NOW);
}

function runs(...list: { path: string; status: string; name?: string }[]) {
  return async () => new Response(JSON.stringify({ workflow_runs: list }), { status: 200 });
}

const used = async (env: Env) => Number((await readState(env.DB, autoCountKey(NOW))) ?? 0);
const audits = (env: Env, action: string) =>
  ((env as any).sqlite.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;

describe("autoApprove", () => {
  it("does nothing while disabled - not even a lease", async () => {
    const env = makeEnv();
    insertCandidate(env, "1");
    const deps = fakeDeps();
    expect(await autoApprove(env, deps)).toEqual({ outcome: "skipped", detail: "disabled" });
    expect(deps.repo.commits).toEqual([]);
    expect((env as any).sqlite.db.prepare("SELECT COUNT(*) AS n FROM admin_locks").get().n).toBe(0);
  });

  it("approves the next batch, oldest first, the way a reviewer would", async () => {
    const env = makeEnv();
    const a = insertCandidate(env, "1", undefined, "2026-09-01T00:00:00Z");
    const b = insertCandidate(env, "2", undefined, "2026-09-02T00:00:00Z");
    const c = insertCandidate(env, "3", undefined, "2026-09-03T00:00:00Z");
    await enable(env, { batchSize: 2 });
    const deps = fakeDeps();

    const out = await autoApprove(env, deps);
    expect(out).toMatchObject({ outcome: "approved", count: 2 });
    expect(deps.repo.commits.at(-1)!.headline).toBe("queue: 2 auto-approved");
    expect(deps.repo.files.get(QUEUE)).toBe(
      '{"link":"https://store.steampowered.com/app/1/"}\n{"link":"https://store.steampowered.com/app/2/"}\n',
    );
    expect([rowStatus(env, a), rowStatus(env, b), rowStatus(env, c)]).toEqual(["approved", "approved", "pending"]);
    const row = (env as any).sqlite.db.prepare("SELECT decided_by FROM ingest_queue WHERE id = ?").get(a);
    expect(row.decided_by).toBe("auto-approve");
    expect(await used(env)).toBe(2);
    expect(JSON.parse((await readState(env.DB, AUTO_LAST_KEY))!)).toMatchObject({ outcome: "approved", count: 2 });
    const job = (env as any).sqlite.db.prepare("SELECT kind, status, requested_by FROM commit_jobs").get();
    expect(job).toEqual({ kind: "auto.approve", status: "committed", requested_by: "auto-approve" });
  });

  it("waits until the previous batch has left the queue file", async () => {
    const env = makeEnv();
    insertCandidate(env, "1");
    await enable(env);
    const deps = fakeDeps();
    deps.repo.files.set(QUEUE, '{"link":"https://store.steampowered.com/app/9/"}\n');
    const out = await autoApprove(env, deps);
    expect(out).toEqual({ outcome: "skipped", detail: "the previous batch is still in scripts/temp_info.jsonl" });
    expect(deps.repo.commits).toEqual([]);
    expect(await used(env)).toBe(0);
  });

  it("waits while a data-write workflow is running or waiting its turn", async () => {
    for (const status of ["in_progress", "queued", "pending", "waiting"]) {
      const env = makeEnv();
      insertCandidate(env, "1");
      await enable(env);
      const deps = fakeDeps({ gh: runs({ path: ".github/workflows/update-reviews.yml", status, name: "Update Reviews" }) });
      const out = await autoApprove(env, deps);
      expect(out.detail).toBe(`pipeline busy: Update Reviews is ${status}`);
      expect(deps.repo.commits).toEqual([]);
    }
    // A finished run, or a running workflow outside data-write, is no reason to wait.
    const env = makeEnv();
    insertCandidate(env, "1");
    await enable(env);
    const deps = fakeDeps({
      gh: runs(
        { path: ".github/workflows/update-reviews.yml", status: "completed" },
        { path: ".github/workflows/web-ci.yml", status: "in_progress" },
      ),
    });
    expect((await autoApprove(env, deps)).outcome).toBe("approved");
  });

  it("fails closed when GitHub cannot be read", async () => {
    const env = makeEnv();
    insertCandidate(env, "1");
    await enable(env);
    const deps = fakeDeps({ gh: async () => new Response("down", { status: 500 }) });
    const out = await autoApprove(env, deps);
    expect(out.outcome).toBe("skipped");
    expect(out.detail).toMatch(/^GitHub unreachable/);
    expect(deps.repo.commits).toEqual([]);
  });

  it("keeps to the daily limit across batches", async () => {
    const env = makeEnv();
    for (const id of ["1", "2", "3", "4"]) insertCandidate(env, id);
    await enable(env, { batchSize: 2, dailyLimit: 3 });
    const deps = fakeDeps();

    expect((await autoApprove(env, deps)).count).toBe(2);
    deps.repo.files.set(QUEUE, ""); // ingest_new.py took the batch
    expect((await autoApprove(env, deps)).count).toBe(1);
    deps.repo.files.set(QUEUE, "");
    expect(await autoApprove(env, deps)).toEqual({ outcome: "skipped", detail: "daily limit reached (3/3)" });
    expect(await used(env)).toBe(3);
  });

  it("takes only what is eligible", async () => {
    const env = makeEnv();
    const ok = insertCandidate(env, "1", "backfill:2024Q3");
    insertCandidate(env, "2", "discover"); // source not allowed
    insertCandidate(env, "3", "backfill:2024Q4", new Date(NOW.getTime() - 3_600_000).toISOString()); // too fresh
    insertCandidate(env, "4");
    insertDecision(env, "4", "rejected"); // decided
    insertCandidate(env, "5");
    insertRow(env, { appid: "5", status: "committed" }); // published
    insertRow(env, { appid: "6", source: "backfill:2024Q3", app_type: "dlc", is_free: 1, health_status: "ok" });
    insertRow(env, { appid: "7", source: "backfill:2024Q3", app_type: "game", is_free: 0, health_status: "ok" });
    insertRow(env, { appid: "8", source: "backfill:2024Q3", app_type: "game", is_free: 1, health_status: "unknown" });
    insertCandidate(env, "9"); // in the blocklist
    await enable(env, { sources: ["backfill:*"], minAgeHours: 24 });
    const deps = fakeDeps();
    deps.repo.files.set(
      "data/blocklist.jsonl",
      serializeEntry(makeEntry("9", "Nine", "broken", "", "2026-09-01T00:00:00Z")) + "\n",
    );

    const out = await autoApprove(env, deps);
    expect(out).toMatchObject({ outcome: "approved", count: 1 });
    expect(rowStatus(env, ok)).toBe("approved");
    expect(deps.repo.appended).toEqual([["https://store.steampowered.com/app/1/"]]);
  });

  it("returns the budget when the commit fails, and audits the failure once", async () => {
    const env = makeEnv();
    const a = insertCandidate(env, "1");
    await enable(env);
    const deps = fakeDeps({ failCommit: "Resource not accessible by integration" });
    expect((await autoApprove(env, deps)).outcome).toBe("failed");
    expect((await autoApprove(env, deps)).outcome).toBe("failed");
    expect(await used(env)).toBe(0);
    expect(rowStatus(env, a)).toBe("pending");
    expect(audits(env, "auto.approve.failed")).toBe(1);
  });

  it("runs by hand while the schedule is off, as the person who asked", async () => {
    const env = makeEnv();
    const a = insertCandidate(env, "1");
    const deps = fakeDeps();
    const out = await autoApprove(env, deps, { manual: true, actor: "reviewer@example.com" });
    expect(out.outcome).toBe("approved");
    const row = (env as any).sqlite.db.prepare("SELECT decided_by FROM ingest_queue WHERE id = ?").get(a);
    expect(row.decided_by).toBe("reviewer@example.com");
  });

  it("stays out while another run holds the lease", async () => {
    const env = makeEnv();
    insertCandidate(env, "1");
    await enable(env);
    await acquireLease(env.DB, "auto-approve", "other", 60_000, NOW);
    expect(await autoApprove(env, fakeDeps())).toEqual({ outcome: "skipped", detail: "another run in progress" });
  });

  it("does nothing at all without migration 0002", async () => {
    const env = makeEnv();
    insertCandidate(env, "1");
    (env as any).sqlite.db.exec("DROP TABLE admin_state; DROP TABLE admin_locks;");
    const out = await autoApprove(env, fakeDeps(), { manual: true });
    expect(out.outcome).toBe("skipped");
    expect(out.detail).toMatch(/state unavailable/);
  });

  it("orders by players or by newest when asked", async () => {
    const env = makeEnv();
    insertRow(env, { appid: "1", source: "s", app_type: "game", is_free: 1, health_status: "ok", current_players_num: 5, first_seen_at: "2026-09-01T00:00:00Z" });
    insertRow(env, { appid: "2", source: "s", app_type: "game", is_free: 1, health_status: "ok", current_players_num: 50, first_seen_at: "2026-09-02T00:00:00Z" });
    insertRow(env, { appid: "3", source: "s", app_type: "game", is_free: 1, health_status: "ok", current_players_num: null, first_seen_at: "2026-09-03T00:00:00Z" });
    const ids = async (order: AutoSettings["order"]) =>
      (await selectCandidates(env, { ...AUTO_DEFAULTS, order }, NOW, 10)).map((r) => r.appid);
    expect(await ids("players")).toEqual(["2", "1", "3"]);
    expect(await ids("newest")).toEqual(["3", "2", "1"]);
    expect(await ids("oldest")).toEqual(["1", "2", "3"]);
  });
});
