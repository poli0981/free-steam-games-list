import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalAc } from "./anti-cheat";
import { ANTI_CHEAT_ENUM } from "./enums";

/**
 * The anti-cheat patterns live twice: ANTI_CHEAT_PATTERNS in
 * scripts/core/constants.py labels what the pipeline writes, and anti-cheat.ts
 * buckets it for the charts and filters. A pattern on one side only is a
 * product the pipeline labels and the site files under "Other" (Steam's
 * disclosure calls Denuvo just "Denuvo"). Nothing else held the two equal.
 */

function pythonPatterns(): [string, string[]][] {
  const src = readFileSync(join(__dirname, "..", "..", "..", "scripts", "core", "constants.py"), "utf-8");
  const body = src.split("ANTI_CHEAT_PATTERNS")[1].split("\n}")[0];
  const out: [string, string[]][] = [];
  for (const line of body.split("\n")) {
    const m = /^\s*"([^"]+)":\s*\[([^\]]*)\]/.exec(line);
    if (m) out.push([m[1], [...m[2].matchAll(/"([^"]*)"/g)].map((p) => p[1])]);
  }
  return out;
}

describe("anti-cheat patterns", () => {
  const python = pythonPatterns();

  it("reads the Python table", () => {
    expect(python.length).toBeGreaterThanOrEqual(14);
  });

  it("knows every product the pipeline labels, in the same order", () => {
    expect(ANTI_CHEAT_ENUM).toEqual(["-", ...python.map(([key]) => key)]);
  });

  it("files every Python pattern, and every label, under its own product", () => {
    for (const [key, patterns] of python) {
      expect(canonicalAc(key), key).toBe(key);
      for (const p of patterns) expect(canonicalAc(p), `${key}: ${p}`).toBe(key);
    }
  });

  it("files the names Steam's disclosure uses", () => {
    expect(canonicalAc("Denuvo")).toBe("Denuvo AC");
    expect(canonicalAc("VAC (Valve Anti-Cheat)")).toBe("VAC");
    expect(canonicalAc("KSS (Krafton Security Services)")).toBe("KSS");
    expect(canonicalAc("-")).toBeNull();
  });
});
