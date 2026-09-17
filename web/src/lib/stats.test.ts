import { describe, expect, it } from "vitest";
import { countByMonth, monthKey, monthLabel, runningTotal } from "./stats";

describe("monthly series", () => {
  it("reads the month from a timestamp and rejects nonsense", () => {
    expect(monthKey("2026-05-14T08:07:18Z")).toBe("2026-05");
    expect(monthKey("2026-13-01")).toBeNull();
    expect(monthKey("")).toBeNull();
    expect(monthKey(undefined)).toBeNull();
    expect(monthKey("1970-01-01T00:00:00Z")).toBeNull();
  });

  it("fills the months nothing happened in", () => {
    const series = countByMonth(["2026-03-01", "2026-03-20", "2026-06-02", "", null, "garbage"]);
    expect(series).toEqual([
      { month: "2026-03", count: 2 },
      { month: "2026-04", count: 0 },
      { month: "2026-05", count: 0 },
      { month: "2026-06", count: 1 },
    ]);
  });

  it("crosses a year boundary", () => {
    expect(countByMonth(["2025-11-30", "2026-02-01"]).map((s) => s.month)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("is empty for no dated values", () => {
    expect(countByMonth(["", undefined])).toEqual([]);
  });

  it("keeps a running total", () => {
    expect(runningTotal([{ count: 2 }, { count: 0 }, { count: 5 }])).toEqual([2, 2, 7]);
  });

  it("labels a month in the reader's language", () => {
    expect(monthLabel("2026-05", "en")).toBe("May 2026");
    expect(monthLabel("2026-05", "vi")).toMatch(/2026/);
  });
});
