import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_MIGRATIONS } from "./admin-api";

describe("ADMIN_MIGRATIONS", () => {
  it("lists exactly the migration files the Worker ships", () => {
    const files = readdirSync(join(__dirname, "..", "worker", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect([...ADMIN_MIGRATIONS]).toEqual(files);
  });
});
