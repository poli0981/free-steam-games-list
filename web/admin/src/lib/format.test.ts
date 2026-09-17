import { describe, expect, it } from "vitest";
import { exactTime, plural, prettyJson, rangeLabel, relativeTime, shortSha, showValue } from "./format";

const NOW = Date.parse("2026-09-17T12:00:00Z");

describe("format", () => {
  it("relativeTime", () => {
    expect(relativeTime("2026-09-17T11:59:30Z", NOW)).toBe("just now");
    expect(relativeTime("2026-09-17T09:00:00Z", NOW)).toBe("3 hours ago");
    expect(relativeTime("2026-09-16T12:00:00Z", NOW)).toBe("yesterday");
    expect(relativeTime(null, NOW)).toBe("—");
    expect(relativeTime("not a date", NOW)).toBe("not a date");
  });

  it("exactTime is UTC to the minute", () => {
    expect(exactTime("2026-09-17T12:04:59.123Z")).toBe("2026-09-17 12:04 UTC");
  });

  it("rangeLabel", () => {
    expect(rangeLabel(0, 50, 646)).toBe("1–50 of 646");
    expect(rangeLabel(600, 46, 646)).toBe("601–646 of 646");
    expect(rangeLabel(0, 0, 0)).toBe("0 of 0");
  });

  it("plural and shortSha", () => {
    expect(plural(1, "row")).toBe("1 row");
    expect(plural(1200, "row")).toBe("1,200 rows");
    expect(shortSha("0123456789abcdef")).toBe("0123456");
    expect(shortSha(null)).toBe("—");
  });

  it("showValue distinguishes empty, null and booleans", () => {
    expect(showValue("")).toBe("(empty)");
    expect(showValue(null)).toBe("null");
    expect(showValue(false)).toBe("false");
    expect(showValue("FPS")).toBe("FPS");
  });

  it("prettyJson falls back to the raw text", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson("{broken")).toBe("{broken");
  });
});
