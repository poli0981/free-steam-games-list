/**
 * DATA_WORKFLOWS must name every workflow in `concurrency: data-write`:
 * auto-approve waits for exactly those, and one missing from the list is one
 * whose pending run an automatic batch could evict.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_WORKFLOWS } from "./pipeline";

const REPO = join(__dirname, "..", "..");
const DIR = join(REPO, ".github", "workflows");

describe("DATA_WORKFLOWS", () => {
  it("marks exactly the data-write workflows", () => {
    const inGroup = readdirSync(DIR)
      .filter((f) => f.endsWith(".yml") && /group\s*:\s*data-write\b/.test(readFileSync(join(DIR, f), "utf-8")))
      .map((f) => `.github/workflows/${f}`)
      .sort();
    expect(inGroup.length).toBeGreaterThanOrEqual(10);
    const listed = DATA_WORKFLOWS.filter((w) => w.dataWrite).map((w) => w.file).sort();
    expect(listed).toEqual(inGroup);
  });

  it("names files that exist, once each", () => {
    for (const w of DATA_WORKFLOWS) expect(existsSync(join(REPO, w.file)), w.file).toBe(true);
    expect(new Set(DATA_WORKFLOWS.map((w) => w.file)).size).toBe(DATA_WORKFLOWS.length);
  });
});
