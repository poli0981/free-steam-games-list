import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_MIGRATIONS, AUDIT_ACTIONS, JOB_KINDS } from "./admin-api";

describe("ADMIN_MIGRATIONS", () => {
  it("lists exactly the migration files the Worker ships", () => {
    const files = readdirSync(join(__dirname, "..", "worker", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect([...ADMIN_MIGRATIONS]).toEqual(files);
  });
});

/** Every non-test .ts file under worker/, as text. */
function workerSources(dir = join(__dirname, "..", "worker")): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "testing" && name !== "generated") out.push(...workerSources(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(readFileSync(full, "utf-8"));
    }
  }
  return out;
}

describe("JOB_KINDS / AUDIT_ACTIONS", () => {
  // The Jobs and Audit pages filter on these lists; an action written but
  // not listed could only be found by paging through everything.
  const sources = workerSources();

  it("cover every literal audit action the Worker writes", () => {
    const used = new Set<string>();
    for (const text of sources) {
      for (const m of text.matchAll(/\baudit\(\s*env[^,]*,\s*[^,]+,\s*"([a-z][a-z.]*)"/g)) used.add(m[1]);
      for (const m of text.matchAll(/VALUES \('[a-z-]+', '([a-z][a-z.]*)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    for (const action of used) expect(AUDIT_ACTIONS, action).toContain(action);
  });

  it("cover every job kind, and the failure actions derived from it", () => {
    const kinds = new Set<string>();
    for (const text of sources) {
      for (const m of text.matchAll(/\bkind:\s*"([a-z][a-z.]*)"/g)) kinds.add(m[1]);
    }
    for (const kind of kinds) expect(JOB_KINDS, kind).toContain(kind);
    for (const kind of JOB_KINDS) {
      expect(AUDIT_ACTIONS).toContain(kind);
      expect(AUDIT_ACTIONS).toContain(`${kind}.failed`);
    }
  });
});
