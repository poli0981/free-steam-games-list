import { describe, expect, it } from "vitest";
import { deletable, handleEditApi, validateValue } from "./edit";
import { MANUAL_FIELDS, toWire, validate } from "../../admin/src/lib/fields";
import { ADMIN, fakeDeps, makeEnv, request } from "../testing/fixtures";

const RECORD = { link: "https://store.steampowered.com/app/730/", name: "Counter-Strike 2", genre: "FPS", safe: "?" };

async function call(env: Env, deps: ReturnType<typeof fakeDeps>, method: string, path: string, body?: unknown) {
  const { request: req, url } = request(method, path, body);
  const res = await handleEditApi(req, url, env, ADMIN, deps);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("deletable", () => {
  it("refuses while any field is still overridden", () => {
    expect(deletable({ fields: { genre: { value: "Shooter" } }, retired: {} }, RECORD).ok).toBe(false);
  });

  it("refuses while a retired value has not been restored yet", () => {
    const doc = { fields: {}, retired: { genre: { value: "Shooter", was: "FPS" } } };
    const r = deletable(doc, { ...RECORD, genre: "Shooter" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not restored yet: genre/);
  });

  it("allows it once every retirement has done its job", () => {
    const doc = { fields: {}, retired: { genre: { value: "Shooter", was: "FPS" } } };
    expect(deletable(doc, RECORD).ok).toBe(true);
    // An override that never changed anything has nothing to restore.
    expect(deletable({ fields: {}, retired: { safe: { value: "?", was: "?" } } }, RECORD).ok).toBe(true);
  });
});

describe("POST /api/admin/edit", () => {
  it("writes an override and records a commit job", async () => {
    const env = makeEnv();
    const deps = fakeDeps({ records: { "730": RECORD } });
    const { status, body } = await call(env, deps, "POST", "/api/admin/edit", {
      appid: "730",
      set: { genre: "Tactical Shooter" },
      reason: "Steam's own tag",
    });
    expect(status).toBe(200);
    expect(body.commit).toMatch(/^sha/);
    const doc = JSON.parse(deps.repo.files.get("data/overrides/730.json")!);
    expect(doc.fields.genre).toMatchObject({ value: "Tactical Shooter", was: "FPS" });
    const job = env.sqlite.db.prepare("SELECT kind, status, target_path FROM commit_jobs").get() as any;
    expect(job).toEqual({ kind: "override", status: "committed", target_path: "data/overrides/730.json" });
  });

  it("deletes a settled override file in its own commit", async () => {
    const env = makeEnv();
    const deps = fakeDeps({ records: { "730": RECORD } });
    deps.repo.files.set(
      "data/overrides/730.json",
      JSON.stringify({ schema: 1, appid: "730", fields: {}, retired: { genre: { value: "Shooter", was: "FPS" } } }),
    );

    const game = await call(env, deps, "GET", "/api/admin/game?appid=730");
    expect(game.body.deletable).toEqual({ ok: true, reason: "" });

    const { status, body } = await call(env, deps, "POST", "/api/admin/edit", { appid: "730", delete: true });
    expect(status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(deps.repo.files.has("data/overrides/730.json")).toBe(false);
    expect(deps.repo.commits.at(-1)?.deletions).toEqual(["data/overrides/730.json"]);
    const job = env.sqlite.db.prepare("SELECT kind FROM commit_jobs").get() as any;
    expect(job.kind).toBe("override.delete");
  });

  it("refuses to delete a file that still pins a value", async () => {
    const env = makeEnv();
    const deps = fakeDeps({ records: { "730": RECORD } });
    deps.repo.files.set(
      "data/overrides/730.json",
      JSON.stringify({ schema: 1, appid: "730", fields: { genre: { value: "FPS", was: "Action" } }, retired: {} }),
    );
    const { status, body } = await call(env, deps, "POST", "/api/admin/edit", { appid: "730", delete: true });
    expect(status).toBe(409);
    expect(body.error).toMatch(/retire them first/);
    expect(deps.repo.files.has("data/overrides/730.json")).toBe(true);
  });

  it("refuses to mix delete with other changes, or with several games", async () => {
    const env = makeEnv();
    const deps = fakeDeps({ records: { "730": RECORD } });
    expect((await call(env, deps, "POST", "/api/admin/edit", { appid: "730", delete: true, retire: ["genre"] })).status).toBe(400);
    expect((await call(env, deps, "POST", "/api/admin/edit", { appids: ["730", "570"], delete: true })).status).toBe(400);
  });

  it("marks the job failed when the commit fails", async () => {
    const env = makeEnv();
    const deps = fakeDeps({ records: { "730": RECORD }, failCommit: "branch protected" });
    const { status } = await call(env, deps, "POST", "/api/admin/edit", { appid: "730", set: { safe: "y" } });
    expect(status).toBe(502);
    expect((env.sqlite.db.prepare("SELECT status FROM commit_jobs").get() as any).status).toBe("failed");
  });
});

describe("the admin form's validation mirror (admin/src/lib/fields.ts)", () => {
  // The form warns before a commit is attempted. If its rules drift from the
  // Worker's, it either blocks a valid correction or lets the reviewer reach a
  // 400 it said would not happen.
  const TEXT = ["", "   ", "Action", " Action ", "online", "offline", "Online", "y", "n", "?", "yes", "x".repeat(500), "x".repeat(501)];

  it("agrees with validateValue() for every field", () => {
    for (const field of MANUAL_FIELDS) {
      const inputs = field === "is_kernel_ac" ? ["true", "false", "null"] : TEXT;
      for (const text of inputs) {
        const client = validate(field, text) === null;
        const server = validateValue(field, toWire(field, text)) === null;
        expect(client, `${field} = ${JSON.stringify(text.length > 20 ? `${text.length} chars` : text)}`).toBe(server);
      }
    }
  });
});
