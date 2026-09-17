import { describe, expect, it } from "vitest";
import { publishedAppids, reconcileApproved } from "./reconcile";
import { acquireLease } from "./locks";
import { decisionOf, fakeDeps, insertDecision, insertRow, makeEnv, rowStatus, shardLine } from "../testing/fixtures";

function dataset(appids: string[], stamp = "2026-09-17T00:00:00Z") {
  return {
    "data/index.json": JSON.stringify({ last_updated: stamp, files: [{ name: "data_001.jsonl", sha256: stamp }] }),
    "data/data_001.jsonl": appids.map((a) => shardLine(a)).join("\n") + "\n",
    "scripts/removed_games.jsonl": "",
  };
}

describe("publishedAppids", () => {
  it("reads the link field only, not a store URL quoted in a note", () => {
    const text = [
      shardLine("730"),
      JSON.stringify({ link: "https://store.steampowered.com/app/440/", notes: "see https://store.steampowered.com/app/999/" }),
    ].join("\n");
    expect([...publishedAppids([text])].sort()).toEqual(["440", "730"]);
  });
});

describe("reconcileApproved", () => {
  it("promotes an approved row that has appeared in data/", async () => {
    const env = makeEnv();
    insertRow(env, { id: "a", appid: "100", status: "approved", decided_at: "2026-09-17T10:00:00Z" });
    const out = await reconcileApproved(env, fakeDeps({ raw: dataset(["100"]) }));
    expect(out).toMatchObject({ published: 1, checked: 1 });
    expect(rowStatus(env, "a")).toBe("committed");
    expect(decisionOf(env, "100")).toBe("approved");
  });

  it("sweeps undecided and failed rows whose game is already live", async () => {
    const env = makeEnv();
    insertRow(env, { id: "p", appid: "200", status: "pending" });
    insertRow(env, { id: "f", appid: "201", status: "failed", reject_reason: "never appeared in data/" });
    insertRow(env, { id: "other", appid: "202", status: "pending" });
    insertDecision(env, "201", "rejected");

    const out = await reconcileApproved(env, fakeDeps({ raw: dataset(["200", "201"]) }));
    expect(out.swept).toBe(2);
    expect(rowStatus(env, "p")).toBe("committed");
    expect(rowStatus(env, "f")).toBe("committed");
    expect(rowStatus(env, "other")).toBe("pending");
    // The game is in data/: a stale rejection is replaced by the fact.
    expect(decisionOf(env, "201")).toBe("approved");

    const audit = env.sqlite.db.prepare("SELECT detail_json FROM audit_log WHERE action='reconcile.approved'").get() as any;
    expect(JSON.parse(audit.detail_json).appids.swept.sort()).toEqual(["200", "201"]);
  });

  it("does not fetch the dataset again while it has not changed", async () => {
    const env = makeEnv();
    insertRow(env, { id: "p", appid: "300", status: "pending" });
    const raw = dataset(["999"]);
    const fetched: string[] = [];
    const deps = fakeDeps({ raw });
    const counting = { ...deps, fetchRaw: async (path: string, ttl: number) => (fetched.push(path), deps.fetchRaw(path, ttl)) };

    await reconcileApproved(env, counting);
    expect(fetched).toContain("data/data_001.jsonl");

    fetched.length = 0;
    const second = await reconcileApproved(env, counting);
    expect(second.skipped).toBe("dataset unchanged");
    expect(fetched).toEqual(["data/index.json"]);

    // A manual run always looks.
    fetched.length = 0;
    await reconcileApproved(env, counting, { manual: true });
    expect(fetched).toContain("data/data_001.jsonl");
  });

  it("costs no fetch at all when nothing is approved or sweepable", async () => {
    const env = makeEnv();
    insertRow(env, { id: "c", appid: "400", status: "committed" });
    const fetched: string[] = [];
    const deps = fakeDeps();
    const out = await reconcileApproved(env, { ...deps, fetchRaw: async (p) => (fetched.push(p), null) });
    expect(out.skipped).toBe("nothing approved");
    expect(fetched).toEqual([]);
  });

  it("stays out while another isolate holds the lease", async () => {
    const env = makeEnv();
    insertRow(env, { id: "a", appid: "500", status: "approved", decided_at: "2026-09-17T10:00:00Z" });
    const deps = fakeDeps({ raw: dataset(["500"]) });
    expect(await acquireLease(env.DB, "reconcile", "someone-else", 60_000, deps.now())).toBe("acquired");
    const out = await reconcileApproved(env, deps);
    expect(out.skipped).toBe("another run in progress");
    expect(rowStatus(env, "a")).toBe("approved");
  });

  it("still runs when migration 0002 has not been applied", async () => {
    const env = makeEnv();
    env.sqlite.db.exec("DROP TABLE admin_locks; DROP TABLE admin_state;");
    insertRow(env, { id: "a", appid: "600", status: "approved", decided_at: "2026-09-17T10:00:00Z" });
    const out = await reconcileApproved(env, fakeDeps({ raw: dataset(["600"]) }));
    expect(out.published).toBe(1);
  });

  it("ages out an approval nothing ever observed", async () => {
    const env = makeEnv();
    insertRow(env, { id: "a", appid: "700", status: "approved", decided_at: "2026-09-16T00:00:00Z" });
    const out = await reconcileApproved(env, fakeDeps({ raw: dataset(["1"]) }));
    expect(out.stale).toBe(1);
    expect(rowStatus(env, "a")).toBe("failed");
  });
});
