import { describe, expect, it } from "vitest";
import { handleAdminApi } from "./admin";
import { readState } from "../lib/locks";
import { ADMIN, fakeDeps, insertCandidate, makeEnv, request } from "../testing/fixtures";
import { AUTO_DEFAULTS, AUTO_SETTINGS_KEY } from "../../shared/automation";

async function call(env: Env, deps: ReturnType<typeof fakeDeps>, method: string, path: string, body?: unknown) {
  const { request: req, url } = request(method, path, body);
  const res = await handleAdminApi(req, url, env, ADMIN, deps);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("/admin/api/automation", () => {
  it("shows the settings, today's budget and the next batch", async () => {
    const env = makeEnv();
    insertCandidate(env, "1", "backfill:2024Q3", "2026-09-01T00:00:00Z");
    insertCandidate(env, "2", "discover", "2026-09-02T00:00:00Z");
    const { status, body } = await call(env, fakeDeps(), "GET", "/admin/api/automation");
    expect(status).toBe(200);
    expect(body.settings).toEqual(AUTO_DEFAULTS);
    expect(body.stateAvailable).toBe(true);
    expect(body.today).toEqual({ date: "2026-09-17", used: 0, limit: 300 });
    expect(body.eligible).toBe(2);
    expect(body.preview.map((r: any) => r.appid)).toEqual(["1", "2"]);
    expect(body.sources.map((s: any) => [s.source, s.pending])).toEqual([
      ["backfill:2024Q3", 1],
      ["discover", 1],
    ]);
  });

  it("saves valid settings, audits the change, refuses the rest", async () => {
    const env = makeEnv();
    const deps = fakeDeps();
    const good = { ...AUTO_DEFAULTS, enabled: true, dailyLimit: 100, sources: ["backfill:*"] };
    expect((await call(env, deps, "POST", "/admin/api/automation", { settings: good })).status).toBe(200);
    expect(JSON.parse((await readState(env.DB, AUTO_SETTINGS_KEY))!)).toEqual(good);
    const audit = (env as any).sqlite.db.prepare("SELECT detail_json FROM audit_log WHERE action = 'automation.settings'").get();
    expect(JSON.parse(audit.detail_json)).toEqual({ before: AUTO_DEFAULTS, after: good });

    for (const bad of [
      { ...good, dailyLimit: 501 },
      { ...good, batchSize: 0 },
      { ...good, order: "random" },
      { ...good, sources: ["bad source"] },
      { ...good, enabled: "yes" },
    ]) {
      expect((await call(env, deps, "POST", "/admin/api/automation", { settings: bad })).status).toBe(400);
    }
    expect(JSON.parse((await readState(env.DB, AUTO_SETTINGS_KEY))!)).toEqual(good);
  });

  it("refuses to pretend it saved without migration 0002", async () => {
    const env = makeEnv();
    (env as any).sqlite.db.exec("DROP TABLE admin_state;");
    const { status } = await call(env, fakeDeps(), "POST", "/admin/api/automation", { settings: AUTO_DEFAULTS });
    expect(status).toBe(503);
  });

  it("runs one batch on request", async () => {
    const env = makeEnv();
    insertCandidate(env, "1");
    const deps = fakeDeps();
    const { status, body } = await call(env, deps, "POST", "/admin/api/automation/run");
    expect(status).toBe(200);
    expect(body).toMatchObject({ outcome: "approved", count: 1 });
    expect(deps.repo.appended).toEqual([["https://store.steampowered.com/app/1/"]]);
  });
});
