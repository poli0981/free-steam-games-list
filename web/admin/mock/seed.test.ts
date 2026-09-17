/**
 * The local admin backend's demo data, run through the REAL handlers.
 *
 * `npm run dev:admin` is the only way to see the admin before deploying it, so
 * a seed that no longer fits the schema, or that stops producing the rows the
 * read-only rules exist for, would quietly take that away.
 */
import { describe, expect, it } from "vitest";
import { seed } from "./seed";
import { SqliteD1 } from "../../worker/testing/sqlite-d1";
import { ADMIN, fakeDeps, makeEnv, request } from "../../worker/testing/fixtures";
import { handleAdminApi } from "../../worker/routes/admin";
import { QUEUE_STATUSES } from "../../shared/queue-rules";

const NOW = new Date("2026-09-17T12:00:00Z");
const RECORDS = Array.from({ length: 120 }, (_, i) => ({
  link: `https://store.steampowered.com/app/${1000 + i}/`,
  name: `Game ${i}`,
  header_image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${1000 + i}/header.jpg`,
  reviews: "90% (Very Positive)",
  current_players: "1,234",
}));

function setup() {
  const db = new SqliteD1();
  const env = makeEnv(db);
  const deps = fakeDeps({ now: NOW });
  const { hidden } = seed(db, deps.repo, RECORDS, NOW);
  // The dev server's dataset: every record except the ones the seed hides.
  const shard = RECORDS.filter((r) => !hidden.has(/\/app\/(\d+)/.exec(r.link)![1]))
    .map((r) => JSON.stringify(r))
    .join("\n");
  deps.fetchRaw = async (path) =>
    path === "data/index.json"
      ? JSON.stringify({ last_updated: "2026-09-17T00:00:00Z", files: [{ name: "data_001.jsonl" }] })
      : path === "data/data_001.jsonl"
        ? shard
        : path === "scripts/removed_games.jsonl"
          ? ""
          : null;
  const call = async (method: string, path: string, body?: unknown) => {
    const { request: req, url } = request(method, path, body);
    const res = await handleAdminApi(req, url, env, ADMIN, deps);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { call, hidden };
}

describe("admin mock seed", () => {
  it("fills every queue status", async () => {
    const { call } = setup();
    const { body } = await call("GET", "/api/admin/stats");
    for (const status of QUEUE_STATUSES) expect(body.queue[status], status).toBeGreaterThan(0);
    expect(Object.keys(body.commits).sort()).toEqual(["committed", "failed", "pending"]);
  });

  it("includes an undecided row locked because its game is published", async () => {
    const { call } = setup();
    const { body } = await call("GET", "/api/admin/queue?status=pending&limit=200");
    const locked = body.items.filter((r: { published: boolean }) => r.published);
    expect(locked).toHaveLength(1);
    const refused = await call("POST", "/api/admin/decide", { ids: [locked[0].id], action: "approve" });
    expect(refused.status).toBe(409);
    expect(refused.body.skipped[0].reason).toBe("published");
  });

  it("includes a rejected row that cannot be reopened", async () => {
    const { call } = setup();
    const { body } = await call("GET", "/api/admin/queue?status=rejected&limit=200");
    const blocked = body.items.find((r: { reject_reason: string }) => r.reject_reason === "wrong store page");
    const res = await call("POST", "/api/admin/reopen", { id: blocked.id });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("open-row-exists");
  });

  it("leaves the demo queue standing after a manual reconcile", async () => {
    const { call } = setup();
    const before = (await call("GET", "/api/admin/stats")).body.queue;
    const { body } = await call("POST", "/api/admin/reconcile");
    // Two of the four approvals are in the dataset, and the one published
    // game's two undecided rows are swept (swept counts games). Nothing else
    // moves.
    expect(body).toMatchObject({ published: 2, swept: 1, removed: 0, stale: 0 });
    const after = (await call("GET", "/api/admin/stats")).body.queue;
    expect(after.pending).toBe(before.pending - 1);
    expect(after.failed).toBe(before.failed - 1);
    expect(after.approved).toBe(before.approved - 2);
    expect(after.committed).toBe(before.committed + 4);
  });
});
