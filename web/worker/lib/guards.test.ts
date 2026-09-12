/**
 * The input guards that stand between an untrusted caller and either the
 * database or a repository write.
 *
 * Each `it` here corresponds to a defect that was live in production, so the
 * assertions double as a record of what the old behaviour was.
 */
import { describe, it, expect } from "vitest";
import { clampLimit, clampOffset } from "./http";
import { validateValue } from "../routes/edit";

describe("clampLimit", () => {
  // The bug: every call site was `Math.min(Number(raw) || fallback, max)`.
  // Number("-1") is -1, which is truthy, so `|| fallback` never fired and
  // Math.min(-1, 200) is -1 — and SQLite treats a negative LIMIT as NO LIMIT.
  // `/api/admin/audit?limit=-1` therefore returned the entire, never-pruned
  // audit log, and `?status=pending&limit=-1` the whole queue.
  it("refuses negative limits, which SQLite reads as unlimited", () => {
    expect(clampLimit("-1", 50, 200)).toBe(50);
    expect(clampLimit("-0.5", 50, 200)).toBe(50);
    expect(clampLimit("-99999", 50, 200)).toBe(50);
  });

  it("refuses zero", () => {
    expect(clampLimit("0", 50, 200)).toBe(50);
  });

  it("truncates fractions, which are not valid bind values", () => {
    expect(clampLimit("1.9", 50, 200)).toBe(1);
    expect(clampLimit("10.999", 50, 200)).toBe(10);
  });

  it("caps at max and falls back on junk", () => {
    expect(clampLimit("99999", 50, 200)).toBe(200);
    expect(clampLimit("1e9", 50, 200)).toBe(200);
    expect(clampLimit("abc", 50, 200)).toBe(50);
    expect(clampLimit(null, 50, 200)).toBe(50);
    expect(clampLimit("", 50, 200)).toBe(50);
    expect(clampLimit("Infinity", 50, 200)).toBe(50);
    expect(clampLimit("NaN", 50, 200)).toBe(50);
  });

  it("passes ordinary values through untouched", () => {
    expect(clampLimit("5", 50, 200)).toBe(5);
    expect(clampLimit("200", 50, 200)).toBe(200);
  });
});

describe("clampOffset", () => {
  it("floors at zero and caps at max", () => {
    expect(clampOffset("-5")).toBe(0);
    expect(clampOffset("abc")).toBe(0);
    expect(clampOffset(null)).toBe(0);
    expect(clampOffset("1e9")).toBe(1_000_000);
    expect(clampOffset("120")).toBe(120);
    expect(clampOffset("12.7")).toBe(12);
  });
});

describe("validateValue — the mirror of Python's validate_value()", () => {
  // scripts/core/overrides.py is authoritative. These cases mirror it exactly,
  // INCLUDING the ordering quirk that the 500-character cap is applied after
  // the enum checks, so an over-long "online" reports the length error.
  it("accepts only manual fields", () => {
    expect(validateValue("genre", "RTS")).toBeNull();
    expect(validateValue("name", "nope")).toBe("not a manual field");
    expect(validateValue("current_players", "1")).toBe("not a manual field");
  });

  it("treats is_kernel_ac as tri-state", () => {
    expect(validateValue("is_kernel_ac", true)).toBeNull();
    expect(validateValue("is_kernel_ac", false)).toBeNull();
    expect(validateValue("is_kernel_ac", null)).toBeNull();
    expect(validateValue("is_kernel_ac", "true")).toBe("must be true, false or null");
  });

  // An override may never set a field empty: the next scrape refills it
  // (fill-if-empty) and this layer re-blanks it, rewriting shards on every run.
  it("refuses empty and whitespace-only values", () => {
    expect(validateValue("genre", "")).toBe(
      "empty - retire the field instead of blanking it",
    );
    expect(validateValue("genre", "   ")).toBe(
      "empty - retire the field instead of blanking it",
    );
  });

  it("enforces the closed enums", () => {
    expect(validateValue("type_game", "online")).toBeNull();
    expect(validateValue("type_game", "offline")).toBeNull();
    expect(validateValue("type_game", "hybrid")).toBe("must be 'online' or 'offline'");
    expect(validateValue("safe", "y")).toBeNull();
    expect(validateValue("safe", "n")).toBeNull();
    expect(validateValue("safe", "?")).toBeNull();
    expect(validateValue("safe", "maybe")).toBe("must be 'y', 'n' or '?'");
  });

  it("caps length at 500, and does so AFTER the enum checks", () => {
    expect(validateValue("notes", "x".repeat(500))).toBeNull();
    expect(validateValue("notes", "x".repeat(501))).toBe("longer than 500 characters");
    // Python reports the length error here too, not the enum error, because
    // the enum check passes first. Diverging on this would make the CLI and
    // the Worker disagree about which message a reviewer sees.
    expect(validateValue("type_game", "online".padEnd(501, "x"))).toBe(
      "must be 'online' or 'offline'",
    );
  });

  it("rejects non-strings for string fields", () => {
    expect(validateValue("genre", 42)).toBe("must be a string");
    expect(validateValue("genre", null)).toBe("must be a string");
  });
});
