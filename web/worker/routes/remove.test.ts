/**
 * Removing games and restoring one, through the real admin router against the
 * real schema, with GitHub faked (fixtures.ts).
 */
import { describe, expect, it } from "vitest";
import { handleAdminApi } from "./admin";
import { reconcileApproved } from "../lib/reconcile";
import { acquireLease } from "../lib/locks";
import { ADMIN, decisionOf, fakeDeps, insertDecision, insertRow, makeEnv, request, rowStatus, shardLine } from "../testing/fixtures";
import { parseBlocklist, serializeEntry } from "../../shared/removal";

const BLOCKLIST = "data/blocklist.jsonl";
const QUEUE = "scripts/temp_info.jsonl";

function dataset(appids: string[]) {
  return {
    "data/index.json": JSON.stringify({ last_updated: "t", files: [{ name: "data_001.jsonl", sha256: "fake" }] }),
    "data/data_001.jsonl": appids.map((a) => shardLine(a, { header_image: `h${a}.jpg` })).join("\n") + "\n",
    "scripts/removed_games.jsonl": "",
  };
}

async function call(env: Env, deps: ReturnType<typeof fakeDeps>, method: string, path: string, body?: unknown) {
  const { request: req, url } = request(method, path, body);
  const res = await handleAdminApi(req, url, env, ADMIN, deps);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

function decisionReason(env: Env, appid: string): string | null {
  const row = (env as any).sqlite.db.prepare("SELECT reason FROM ingest_decisions WHERE appid = ?").get(appid);
  return row?.reason ?? null;
}

describe("POST /admin/api/remove", () => {
  it("commits the blocklist lines and makes the queue agree", async () => {
    const env = makeEnv();
    insertRow(env, { id: "c10", appid: "10", status: "committed" });
    insertDecision(env, "10", "approved");
    insertRow(env, { id: "f20", appid: "20", status: "failed" });
    insertRow(env, { id: "p30", appid: "30", status: "pending" });
    const deps = fakeDeps({ raw: dataset(["10", "20", "30"]) });

    const { status, body } = await call(env, deps, "POST", "/admin/api/remove", {
      appids: ["10", "20", "99", "10"],
      reason: "duplicate",
      note: "same as\n30",
    });
    expect(status).toBe(200);
    expect(body.removed).toEqual(["10", "20"]);
    expect(body.skipped).toEqual([{ appid: "99", reason: "not-in-catalogue" }]);

    const text = deps.repo.files.get(BLOCKLIST)!;
    const entries = parseBlocklist(text);
    expect([...entries.keys()]).toEqual(["10", "20"]);
    expect(entries.get("10")).toMatchObject({ name: "Game 10", reason: "duplicate", note: "same as 30", by: "admin" });
    expect(text.split("\n").filter(Boolean)).toEqual([...entries.values()].map(serializeEntry));
    expect(text).not.toContain("@");

    const commit = deps.repo.commits.at(-1)!;
    expect(commit.headline).toBe("blocklist: remove 2 games");
    expect(commit.body).not.toContain("@");

    // Unpublishing is a fact: the approved decision is replaced.
    expect(decisionOf(env, "10")).toBe("rejected");
    expect(decisionReason(env, "10")).toBe("removed:duplicate - same as 30");
    expect(rowStatus(env, "c10")).toBe("rejected");
    expect(rowStatus(env, "f20")).toBe("rejected");
    expect(rowStatus(env, "p30")).toBe("pending");

    const job = (env as any).sqlite.db.prepare("SELECT kind, status FROM commit_jobs").get();
    expect(job).toEqual({ kind: "remove", status: "committed" });
  });

  it("repairs the queue on a second request without committing again", async () => {
    const env = makeEnv();
    const deps = fakeDeps({ raw: dataset(["10"]) });
    await call(env, deps, "POST", "/admin/api/remove", { appids: ["10"], reason: "broken" });
    const commits = deps.repo.commits.length;
    // The D1 half of the first request lost, say.
    (env as any).sqlite.db.prepare("UPDATE ingest_decisions SET decision = 'approved' WHERE appid = '10'").run();

    const { status, body } = await call(env, deps, "POST", "/admin/api/remove", { appids: ["10"], reason: "duplicate" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ removed: [], repaired: ["10"], commit: null });
    expect(deps.repo.commits.length).toBe(commits);
    // The ORIGINAL reason is restored, not the new request's.
    expect(decisionReason(env, "10")).toBe("removed:broken");
  });

  it("leaves D1 alone when the commit fails", async () => {
    const env = makeEnv();
    insertDecision(env, "10", "approved");
    const deps = fakeDeps({ raw: dataset(["10"]), failCommit: "GitHub is down" });
    const { status } = await call(env, deps, "POST", "/admin/api/remove", { appids: ["10"], reason: "broken" });
    expect(status).toBe(502);
    expect(decisionOf(env, "10")).toBe("approved");
    const job = (env as any).sqlite.db.prepare("SELECT status FROM commit_jobs").get();
    expect(job.status).toBe("failed");
  });

  it("refuses what it cannot honour", async () => {
    const env = makeEnv();
    const deps = fakeDeps({ raw: dataset(["10"]) });
    const many = Array.from({ length: 101 }, (_, i) => String(i + 1));
    expect((await call(env, deps, "POST", "/admin/api/remove", { appids: many, reason: "broken" })).status).toBe(400);
    expect((await call(env, deps, "POST", "/admin/api/remove", { appids: ["10"], reason: "nope" })).status).toBe(400);
    expect((await call(env, deps, "POST", "/admin/api/remove", { appids: ["10"], reason: "other" })).status).toBe(400);
    expect((await call(env, deps, "POST", "/admin/api/remove", { appids: ["x"], reason: "broken" })).status).toBe(400);
    expect((await call(env, deps, "POST", "/admin/api/remove", { appids: ["99"], reason: "broken" })).status).toBe(409);
    expect(deps.repo.commits).toEqual([]);
  });

  it("waits for another removal or restore", async () => {
    const env = makeEnv();
    const deps = fakeDeps({ raw: dataset(["10"]) });
    await acquireLease(env.DB, "blocklist", "someone-else", 60_000, new Date("2026-09-17T12:00:00Z"));
    const { status } = await call(env, deps, "POST", "/admin/api/remove", { appids: ["10"], reason: "broken" });
    expect(status).toBe(409);
    expect(deps.repo.commits).toEqual([]);
  });
});

describe("POST /admin/api/restore", () => {
  async function removed(appids = ["10", "20"]) {
    const env = makeEnv();
    insertRow(env, { id: "c10", appid: "10", status: "committed" });
    insertDecision(env, "10", "approved");
    const deps = fakeDeps({ raw: dataset(["10", "20", "30"]) });
    await call(env, deps, "POST", "/admin/api/remove", { appids, reason: "not_free" });
    return { env, deps };
  }

  it("unblocks and queues the link in ONE commit, then reconcile promotes it", async () => {
    const { env, deps } = await removed();
    const other = deps.repo.files.get(BLOCKLIST)!.split("\n")[1];

    const { status, body } = await call(env, deps, "POST", "/admin/api/restore", { appid: "10" });
    expect(status).toBe(200);
    expect(body.restored).toBe("10");
    const commit = deps.repo.commits.at(-1)!;
    expect(commit.additions.sort()).toEqual([BLOCKLIST, QUEUE]);
    expect(deps.repo.files.get(BLOCKLIST)).toBe(other + "\n");
    expect(deps.repo.files.get(QUEUE)).toBe('{"link":"https://store.steampowered.com/app/10/"}\n');

    expect(decisionOf(env, "10")).toBeUndefined();
    const row = (env as any).sqlite.db
      .prepare("SELECT status, source, decided_by FROM ingest_queue WHERE appid = '10' AND source = 'restore'")
      .get();
    expect(row).toEqual({ status: "approved", source: "restore", decided_by: ADMIN.email });

    // The game is (still, in this fake) in data/: the restore row is promoted.
    const out = await reconcileApproved(env, deps, { manual: true });
    expect(out.published).toBe(1);
    expect(decisionOf(env, "10")).toBe("approved");
  });

  it("deletes only a removal, never a plain rejection", async () => {
    const { env, deps } = await removed(["20"]);
    (env as any).sqlite.db.prepare("UPDATE ingest_decisions SET reason = 'not free' WHERE appid = '20'").run();
    await call(env, deps, "POST", "/admin/api/restore", { appid: "20" });
    expect(decisionOf(env, "20")).toBe("rejected");
  });

  it("refuses a game that is not removed", async () => {
    const { env, deps } = await removed(["20"]);
    const { status, body } = await call(env, deps, "POST", "/admin/api/restore", { appid: "30" });
    expect(status).toBe(409);
    expect(body.reason).toBe("not-removed");
  });
});

describe("reading the catalogue and the blocklist", () => {
  it("searches published games and marks the removed ones", async () => {
    const env = makeEnv();
    const deps = fakeDeps({ raw: dataset(["10", "100", "20"]) });
    await call(env, deps, "POST", "/admin/api/remove", { appids: ["100"], reason: "broken" });

    const search = await call(env, deps, "GET", "/admin/api/catalogue?q=10");
    expect(search.body.items.map((g: any) => [g.appid, !!g.blocked])).toEqual([
      ["10", false],
      ["100", true],
    ]);
    const preview = await call(env, deps, "GET", "/admin/api/catalogue?appids=20,404");
    expect(preview.body.items.map((i: any) => [i.appid, i.found])).toEqual([
      ["20", true],
      ["404", false],
    ]);

    const list = await call(env, deps, "GET", "/admin/api/removed");
    expect(list.body.items.map((i: any) => [i.appid, i.inCatalogue, i.decision?.decision])).toEqual([
      ["100", true, "rejected"],
    ]);
    expect((await call(env, deps, "GET", "/admin/api/removed?summary=1")).body).toEqual({ total: 1, pending: 1 });
  });
});

describe("POST /admin/api/reopen", () => {
  it("sends a removed game to Restore instead", async () => {
    const env = makeEnv();
    insertRow(env, { id: "p10", appid: "10", status: "pending" });
    const deps = fakeDeps({ raw: dataset(["10"]) });
    await call(env, deps, "POST", "/admin/api/remove", { appids: ["10"], reason: "broken" });
    expect(rowStatus(env, "p10")).toBe("rejected");
    const { status, body } = await call(env, deps, "POST", "/admin/api/reopen", { id: "p10" });
    expect(status).toBe(409);
    expect(body.reason).toBe("removed");
    expect(rowStatus(env, "p10")).toBe("rejected");
  });
});
