/**
 * The real admin handlers against the real schema (in-memory SQLite with the
 * migrations applied), with GitHub and the dataset faked.
 *
 * What matters most here is that a row which must not be decided is never
 * decided - and that the reviewer is told which rows were skipped and why,
 * instead of the old silent drop.
 */
import { describe, expect, it } from "vitest";
import { handleAdminApi } from "./admin";
import {
  ADMIN,
  decisionOf,
  fakeDeps,
  insertDecision,
  insertRow,
  makeEnv,
  request,
  rowStatus,
} from "../testing/fixtures";

async function call(env: Env, deps: ReturnType<typeof fakeDeps>, method: string, path: string, body?: unknown) {
  const { request: req, url } = request(method, path, body);
  const res = await handleAdminApi(req, url, env, ADMIN, deps);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("GET /admin/api/queue", () => {
  it("marks rows whose game is already published, per game", async () => {
    const env = makeEnv();
    insertRow(env, { id: "a", appid: "10", status: "pending" });
    insertRow(env, { id: "b", appid: "10", status: "committed" });
    insertRow(env, { id: "c", appid: "20", status: "failed" });
    insertDecision(env, "20", "approved");
    insertRow(env, { id: "d", appid: "30", status: "pending" });

    const { body } = await call(env, fakeDeps(), "GET", "/admin/api/queue?status=pending");
    const byId = Object.fromEntries(body.items.map((r: any) => [r.id, r.published]));
    expect(byId).toEqual({ a: true, d: false });

    const failed = await call(env, fakeDeps(), "GET", "/admin/api/queue?status=failed");
    expect(failed.body.items[0].published).toBe(true);
  });

  it("searches every status at once, but only with a query", async () => {
    const env = makeEnv();
    insertRow(env, { id: "p", appid: "4242", status: "pending" });
    insertRow(env, { id: "r", appid: "4242", status: "rejected" });
    insertRow(env, { id: "x", appid: "999", status: "pending" });

    const { body } = await call(env, fakeDeps(), "GET", "/admin/api/queue?status=all&q=4242");
    expect(body.items.map((r: any) => r.id).sort()).toEqual(["p", "r"]);
    expect(body.total).toBe(2);

    expect((await call(env, fakeDeps(), "GET", "/admin/api/queue?status=all")).status).toBe(400);
    expect((await call(env, fakeDeps(), "GET", "/admin/api/queue?status=bogus")).status).toBe(400);
  });
});

describe("POST /admin/api/decide", () => {
  it("reports every skip reason and decides only what may be decided", async () => {
    const env = makeEnv();
    insertRow(env, { id: "ok", appid: "1", status: "pending" });
    insertRow(env, { id: "done", appid: "2", status: "committed" });
    insertRow(env, { id: "live", appid: "3", status: "pending" });
    insertDecision(env, "3", "approved");
    insertRow(env, { id: "dup-old", appid: "4", status: "failed", first_seen_at: "2026-09-01T00:00:00Z" });
    insertRow(env, { id: "dup-new", appid: "4", status: "pending", first_seen_at: "2026-09-05T00:00:00Z" });

    const deps = fakeDeps();
    const { status, body } = await call(env, deps, "POST", "/admin/api/decide", {
      action: "reject",
      ids: ["ok", "done", "live", "dup-old", "dup-new", "ghost"],
      reason: "not free",
    });

    expect(status).toBe(200);
    expect(body.decidedIds.sort()).toEqual(["dup-new", "ok"]);
    const reasons = Object.fromEntries(body.skipped.map((s: any) => [s.id, s.reason]));
    expect(reasons).toEqual({
      done: "not-decidable",
      live: "published",
      ghost: "not-found",
      "dup-old": "duplicate-in-request",
    });
    expect(rowStatus(env, "ok")).toBe("rejected");
    expect(rowStatus(env, "live")).toBe("pending");
    expect(decisionOf(env, "1")).toBe("rejected");
    // An approved decision is a publication record and is never replaced.
    expect(decisionOf(env, "3")).toBe("approved");
  });

  it("refuses approve, reject and defer on a published game", async () => {
    for (const action of ["approve", "reject", "defer"]) {
      const env = makeEnv();
      insertRow(env, { id: "old", appid: "7", status: "committed" });
      insertRow(env, { id: "again", appid: "7", status: "failed" });
      const deps = fakeDeps();
      const { status, body } = await call(env, deps, "POST", "/admin/api/decide", { action, ids: ["again"] });
      expect(status, action).toBe(409);
      expect(body.skipped).toEqual([{ id: "again", appid: "7", reason: "published" }]);
      expect(rowStatus(env, "again")).toBe("failed");
      expect(deps.repo.commits).toEqual([]);
    }
  });

  it("skips, instead of failing with a 500, a requeue that would collide with an open row", async () => {
    const env = makeEnv();
    insertRow(env, { id: "open", appid: "8", status: "pending" });
    insertRow(env, { id: "failed", appid: "8", status: "failed" });
    const { status, body } = await call(env, fakeDeps(), "POST", "/admin/api/decide", { action: "requeue", ids: ["failed"] });
    expect(status).toBe(409);
    expect(body.skipped[0].reason).toBe("open-row-exists");
    expect(rowStatus(env, "failed")).toBe("failed");
  });

  it("reports a no-op move", async () => {
    const env = makeEnv();
    insertRow(env, { id: "p", appid: "9", status: "pending" });
    const { status, body } = await call(env, fakeDeps(), "POST", "/admin/api/decide", { action: "requeue", ids: ["p"] });
    expect(status).toBe(409);
    expect(body.skipped[0].reason).toBe("no-op");
  });

  it("approves: commits the links, records the job, demotes a rival open row", async () => {
    const env = makeEnv();
    insertRow(env, { id: "rival", appid: "11", status: "pending" });
    insertRow(env, { id: "retry", appid: "11", status: "failed", first_seen_at: "2026-09-16T00:00:00Z" });
    const deps = fakeDeps();
    const { status, body } = await call(env, deps, "POST", "/admin/api/decide", {
      action: "approve",
      ids: ["retry"],
      reason: "checked by hand",
    });
    expect(status).toBe(200);
    expect(body.decidedIds).toEqual(["retry"]);
    expect(body.commit).toMatch(/^sha/);
    expect(rowStatus(env, "retry")).toBe("approved");
    expect(rowStatus(env, "rival")).toBe("failed");
    expect(deps.repo.appended).toEqual([["https://store.steampowered.com/app/11/"]]);

    const job = env.sqlite.db.prepare("SELECT kind, status, commit_sha FROM commit_jobs").get() as any;
    expect(job).toMatchObject({ kind: "approve", status: "committed" });
    const audit = env.sqlite.db.prepare("SELECT detail_json FROM audit_log WHERE action='approve'").get() as any;
    expect(JSON.parse(audit.detail_json).reason).toBe("checked by hand");
  });

  it("a commit that lands but whose queue update fails: job committed, honest 500", async () => {
    const env = makeEnv();
    insertRow(env, { id: "r", appid: "12", status: "pending" });
    // Make the queue batch fail after the commit, the way a D1 outage would.
    env.sqlite.db.exec(`CREATE TRIGGER boom BEFORE UPDATE ON ingest_queue BEGIN SELECT RAISE(ABORT, 'd1 down'); END;`);
    const { status, body } = await call(env, fakeDeps(), "POST", "/admin/api/decide", { action: "approve", ids: ["r"] });

    expect(status).toBe(500);
    expect(body.error).toMatch(/landed but the queue could not be updated/);
    expect(body.error).toMatch(/approving them again is safe/);
    const job = env.sqlite.db.prepare("SELECT status FROM commit_jobs").get() as any;
    expect(job.status).toBe("committed");
    const desync = env.sqlite.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='approve.desynced'").get() as any;
    expect(desync.n).toBe(1);
  });

  it("a failed commit leaves the rows untouched and the job failed", async () => {
    const env = makeEnv();
    insertRow(env, { id: "r", appid: "13", status: "pending" });
    const { status } = await call(env, fakeDeps({ failCommit: "github down" }), "POST", "/admin/api/decide", {
      action: "approve",
      ids: ["r"],
    });
    expect(status).toBe(502);
    expect(rowStatus(env, "r")).toBe("pending");
    expect((env.sqlite.db.prepare("SELECT status FROM commit_jobs").get() as any).status).toBe("failed");
  });
});

describe("POST /admin/api/reopen", () => {
  it("returns a rejected row to pending and forgets only the rejection", async () => {
    const env = makeEnv();
    insertRow(env, { id: "r", appid: "21", status: "rejected", decided_by: ADMIN.email, reject_reason: "dup" });
    insertDecision(env, "21", "rejected");
    const { status, body } = await call(env, fakeDeps(), "POST", "/admin/api/reopen", { id: "r" });
    expect(status).toBe(200);
    expect(body.appid).toBe("21");
    expect(rowStatus(env, "r")).toBe("pending");
    expect(decisionOf(env, "21")).toBeUndefined();
  });

  it("refuses when the game is published, and never deletes an approved decision", async () => {
    const env = makeEnv();
    insertRow(env, { id: "r", appid: "22", status: "rejected" });
    insertDecision(env, "22", "approved");
    const { status, body } = await call(env, fakeDeps(), "POST", "/admin/api/reopen", { id: "r" });
    expect(status).toBe(409);
    expect(body.reason).toBe("published");
    expect(decisionOf(env, "22")).toBe("approved");
    expect(rowStatus(env, "r")).toBe("rejected");
  });

  it("refuses when another row for the game is open, and keeps the rejection", async () => {
    const env = makeEnv();
    insertRow(env, { id: "r", appid: "23", status: "rejected" });
    insertRow(env, { id: "open", appid: "23", status: "deferred" });
    insertDecision(env, "23", "rejected");
    const { status, body } = await call(env, fakeDeps(), "POST", "/admin/api/reopen", { id: "r" });
    expect(status).toBe(409);
    expect(body.reason).toBe("open-row-exists");
    expect(decisionOf(env, "23")).toBe("rejected");
  });

  it("refuses a row that is not rejected, and 404s an unknown one", async () => {
    const env = makeEnv();
    insertRow(env, { id: "p", appid: "24", status: "pending" });
    expect((await call(env, fakeDeps(), "POST", "/admin/api/reopen", { id: "p" })).body.reason).toBe("not-rejected");
    expect((await call(env, fakeDeps(), "POST", "/admin/api/reopen", { id: "nope" })).status).toBe(404);
  });
});

describe("jobs, audit and health", () => {
  it("pages with totals and filters", async () => {
    const env = makeEnv();
    for (let i = 0; i < 5; i++) {
      env.sqlite.db
        .prepare("INSERT INTO commit_jobs (id, kind, status, target_path, created_at) VALUES (?, ?, ?, 'x', ?)")
        .run(`j${i}`, i % 2 ? "override" : "approve", "committed", `2026-09-1${i}T00:00:00Z`);
    }
    const page = await call(env, fakeDeps(), "GET", "/admin/api/jobs?limit=2&offset=2");
    expect(page.body.total).toBe(5);
    expect(page.body.items.map((j: any) => j.id)).toEqual(["j2", "j1"]);
    const overrides = await call(env, fakeDeps(), "GET", "/admin/api/jobs?kind=override");
    expect(overrides.body.total).toBe(2);
    expect((await call(env, fakeDeps(), "GET", "/admin/api/jobs?status=weird")).status).toBe(400);
  });

  it("health answers 503 WITH its body when GitHub is down", async () => {
    const env = makeEnv();
    const deps = fakeDeps({ gh: async () => new Response("no", { status: 401 }) });
    const { status, body } = await call(env, deps, "GET", "/admin/api/health");
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, d1: "ok", github: "401", retentionDays: 180 });
    expect(body.migrations).toEqual(["0001_init.sql", "0002_admin_state.sql"]);
  });
});
