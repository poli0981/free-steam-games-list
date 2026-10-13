import { describe, expect, it } from "vitest";
import {
  AUTO_DAILY_CEILING,
  AUTO_DEFAULTS,
  autoCountKey,
  parseSettings,
  sourceMatches,
  validateSettings,
} from "./automation";

describe("validateSettings", () => {
  it("accepts the defaults and the ceilings", () => {
    expect(validateSettings(AUTO_DEFAULTS)).toEqual({ ok: true, settings: AUTO_DEFAULTS });
    const max = { ...AUTO_DEFAULTS, enabled: true, batchSize: 100, dailyLimit: AUTO_DAILY_CEILING, minAgeHours: 168 };
    expect(validateSettings(max).ok).toBe(true);
  });

  it("refuses anything outside the limits", () => {
    for (const bad of [
      null,
      [],
      { ...AUTO_DEFAULTS, batchSize: 101 },
      { ...AUTO_DEFAULTS, batchSize: 1.5 },
      { ...AUTO_DEFAULTS, dailyLimit: AUTO_DAILY_CEILING + 1 },
      { ...AUTO_DEFAULTS, minAgeHours: -1 },
      { ...AUTO_DEFAULTS, order: "random" },
      { ...AUTO_DEFAULTS, sources: "discover" },
      { ...AUTO_DEFAULTS, sources: ["a*b"] },
      { ...AUTO_DEFAULTS, sources: Array.from({ length: 11 }, (_, i) => `s${i}`) },
      { ...AUTO_DEFAULTS, enabled: 1 },
    ]) {
      expect(validateSettings(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("drops duplicate sources", () => {
    const out = validateSettings({ ...AUTO_DEFAULTS, sources: ["discover", "discover", "backfill:*"] });
    expect(out.ok && out.settings.sources).toEqual(["discover", "backfill:*"]);
  });
});

describe("parseSettings", () => {
  it("falls back to the (disabled) defaults for anything it cannot trust", () => {
    expect(parseSettings(undefined)).toEqual(AUTO_DEFAULTS);
    expect(parseSettings("{not json")).toEqual(AUTO_DEFAULTS);
    expect(parseSettings(JSON.stringify({ ...AUTO_DEFAULTS, enabled: true, dailyLimit: 9999 }))).toEqual(AUTO_DEFAULTS);
  });
});

describe("helpers", () => {
  it("matches sources exactly or by prefix", () => {
    expect(sourceMatches("backfill:2024Q3", [])).toBe(true);
    expect(sourceMatches("backfill:2024Q3", ["backfill:*"])).toBe(true);
    expect(sourceMatches("backfill:2024Q3", ["backfill:2024Q4", "discover"])).toBe(false);
    expect(sourceMatches("discover", ["discover"])).toBe(true);
  });

  it("keys the counter by UTC day", () => {
    expect(autoCountKey(new Date("2026-10-13T23:59:59Z"))).toBe("auto.approve.count:2026-10-13");
  });
});
