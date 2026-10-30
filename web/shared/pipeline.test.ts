/**
 * DATA_WORKFLOWS must name every workflow in `concurrency: data-write`:
 * auto-approve waits for exactly those.
 *
 * And every one of them must:
 *   - queue (`queue: max`, `cancel-in-progress: false`). With the default a
 *     run that queued behind a running job evicted the one already waiting:
 *     Update Reviews lost five of ten runs that way in October 2026. Mixing
 *     the two in one group is not documented, so none may;
 *   - check out `main`. A run's commit is fixed when the run is created, and a
 *     run that waited behind another data job would write shards from before
 *     that job's commit - Auto Update JSON failed four days in ten on the
 *     rebase conflict in data/index.json;
 *   - declare `timeout-minutes`, and a JOB_BUDGET_MINUTES at least 20 below
 *     it (scripts/core/budget.py): the script stops in time to save and push.
 *
 * The same holds for any shared group (`discovery`): its members queue, or
 * none of them does.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_WORKFLOWS } from "./pipeline";

const REPO = join(__dirname, "..", "..");
const DIR = join(REPO, ".github", "workflows");

/** The YAML without its comment lines, which quote the old settings. */
function code(file: string): string {
  return readFileSync(join(REPO, file), "utf-8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const TIMEOUT = /timeout-minutes\s*:\s*(.+)/;
const BUDGET = /JOB_BUDGET_MINUTES\s*:\s*(.+)/;

/** The whole numbers on the first line `key` matches: [60] for "60", [340, 45]
 *  for "${{ inputs.backfill && 340 || 45 }}". */
function numbers(text: string, key: RegExp): number[] {
  const line = key.exec(text);
  return line ? (line[1].match(/\d+/g) ?? []).map(Number) : [];
}

const dataWrite = DATA_WORKFLOWS.filter((w) => w.dataWrite).map((w) => w.file);

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

describe("every data-write workflow", () => {
  it("queues its runs instead of evicting the one waiting", () => {
    for (const file of dataWrite) {
      const text = code(file);
      expect(text, file).toMatch(/\bqueue\s*:\s*max\b/);
      expect(text, file).toMatch(/\bcancel-in-progress\s*:\s*false\b/);
    }
  });

  it("checks out main, not the commit its run was created on", () => {
    for (const file of dataWrite) {
      const text = code(file);
      const checkouts = text.match(/uses\s*:\s*actions\/checkout@/g) ?? [];
      const refs = text.match(/\bref\s*:\s*main\b/g) ?? [];
      expect(checkouts.length, file).toBeGreaterThan(0);
      expect(refs.length, file).toBe(checkouts.length);
    }
  });

  it("shares its queue setting with every workflow in its group", () => {
    // A group named by an expression is one run's own; only fixed names are shared.
    const byGroup = new Map<string, boolean[]>();
    for (const f of readdirSync(DIR).filter((name) => name.endsWith(".yml"))) {
      const text = code(`.github/workflows/${f}`);
      const group = /^\s*group\s*:\s*([\w-]+)\s*$/m.exec(text)?.[1];
      if (!group) continue;
      byGroup.set(group, [...(byGroup.get(group) ?? []), /\bqueue\s*:\s*max\b/.test(text)]);
    }
    expect(byGroup.get("discovery")).toEqual([true, true]);
    for (const [group, queues] of byGroup) expect(new Set(queues).size, group).toBe(1);
  });

  it("stops at its budget in time to save before its timeout", () => {
    for (const file of dataWrite) {
      const text = code(file);
      const timeouts = numbers(text, TIMEOUT);
      const budgets = numbers(text, BUDGET);
      expect(timeouts.length, file).toBeGreaterThan(0);
      if (budgets.length === 0) continue;
      expect(budgets.length, file).toBe(timeouts.length);
      budgets.forEach((b, i) => expect(b + 20, `${file}: budget ${b}, timeout ${timeouts[i]}`).toBeLessThanOrEqual(timeouts[i]));
    }
  });
});
