import { describe, expect, it } from "vitest";
import { handleAdminApi } from "./admin";
import { ADMIN, fakeDeps, makeEnv, request, shardLine } from "../testing/fixtures";

async function call(env: Env, deps: ReturnType<typeof fakeDeps>, path: string) {
  const { request: req, url } = request("GET", path);
  const res = await handleAdminApi(req, url, env, ADMIN, deps);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const run = (file: string, status: string, extra: Record<string, unknown> = {}) => ({
  path: `.github/workflows/${file}`,
  name: file,
  status,
  conclusion: status === "completed" ? "success" : null,
  created_at: "2026-09-17T10:00:00Z",
  html_url: `https://github.com/x/runs/${file}/${status}`,
  ...extra,
});

describe("GET /admin/api/pipeline", () => {
  it("groups the latest runs by workflow and lists what is running", async () => {
    const asked: string[] = [];
    const deps = fakeDeps({
      gh: async (_env, path) => {
        asked.push(path);
        if (path.includes("/actions/workflows/")) {
          // /repos/<owner>/<repo>/actions/workflows/<file>/runs
          return new Response(JSON.stringify({ workflow_runs: [run(path.split("/")[6], "completed")] }));
        }
        return new Response(
          JSON.stringify({
            workflow_runs: [
              run("ingest-new.yml", "in_progress"),
              run("ingest-new.yml", "completed"),
              run("web-ci.yml", "in_progress"),
            ],
          }),
        );
      },
    });
    deps.repo.files.set("scripts/temp_info.jsonl", '{"link":"a"}\n{"link":"b"}\n');
    const { status, body } = await call(makeEnv(), deps, "/admin/api/pipeline");
    expect(status).toBe(200);
    const ingest = body.workflows.find((w: any) => w.file === ".github/workflows/ingest-new.yml");
    expect(ingest.latest.status).toBe("in_progress");
    expect(ingest.recent).toHaveLength(2);
    // Not a data workflow: listed nowhere.
    expect(body.active.map((r: any) => r.file)).toEqual([".github/workflows/ingest-new.yml"]);
    expect(body.queue).toEqual({ tempInfo: 2, blocklist: 0 });
    // Workflows missing from the recent runs were asked for by file.
    expect(asked.some((p) => p.includes("/actions/workflows/purge-unhealthy.yml/runs"))).toBe(true);
    const purge = body.workflows.find((w: any) => w.file === ".github/workflows/purge-unhealthy.yml");
    expect(purge.latest.status).toBe("completed");
  });

  it("lists each run once, however GitHub answered", async () => {
    const same = run("update-reviews.yml", "in_progress");
    const deps = fakeDeps({
      gh: async () => new Response(JSON.stringify({ workflow_runs: [same, same, run("ingest-new.yml", "completed")] })),
    });
    const { body } = await call(makeEnv(), deps, "/admin/api/pipeline");
    const urls = [...body.active, ...body.workflows.flatMap((w: any) => w.recent)].map((r: any) => r.html_url);
    expect(body.active).toHaveLength(1);
    expect(new Set(body.workflows.flatMap((w: any) => w.recent).map((r: any) => r.html_url)).size).toBe(
      body.workflows.flatMap((w: any) => w.recent).length,
    );
    expect(urls.length).toBeGreaterThan(0);
  });

  it("answers GitHub trouble with a 502, never a 401/403", async () => {
    const deps = fakeDeps({ gh: async () => new Response("nope", { status: 500 }) });
    const { status, body } = await call(makeEnv(), deps, "/admin/api/pipeline");
    expect(status).toBe(502);
    expect(body.error).toMatch(/500/);
  });
});

describe("GET /admin/api/quality", () => {
  const raw = {
    "data/index.json": JSON.stringify({ last_updated: "t", files: [{ name: "data_001.jsonl", sha256: "fake" }] }),
    "data/data_001.jsonl":
      [
        shardLine("1", { safe: "?", tags: ["x"], languages: ["en"], language_details: [{}], developer: ["d"], publisher: [] }),
        shardLine("2", { safe: "y", tags: [], languages: ["en"], language_details: [{ name: "en" }], developer: ["d"], publisher: ["p"] }),
        shardLine("3", { safe: "?", tags: ["x"], languages: ["en"], language_details: [{ name: "en" }], developer: ["d"], publisher: ["p"] }),
      ].join("\n") + "\n",
  };

  it("counts every check over the catalogue", async () => {
    const { status, body } = await call(makeEnv(), fakeDeps({ raw }), "/admin/api/quality");
    expect(status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.counts["safe-unreviewed"]).toBe(2);
    expect(body.counts["no-tags"]).toBe(1);
    expect(body.counts["no-publisher"]).toBe(1);
  });

  it("lists one check's games, paged", async () => {
    const { body } = await call(makeEnv(), fakeDeps({ raw }), "/admin/api/quality?check=safe-unreviewed&limit=1&offset=1");
    expect(body).toMatchObject({ check: "safe-unreviewed", total: 2, limit: 1, offset: 1 });
    expect(body.items.map((g: any) => g.appid)).toEqual(["3"]);
    expect((await call(makeEnv(), fakeDeps({ raw }), "/admin/api/quality?check=bogus")).status).toBe(400);
  });

  it("says so when the catalogue cannot be read", async () => {
    expect((await call(makeEnv(), fakeDeps(), "/admin/api/quality")).status).toBe(503);
  });
});
