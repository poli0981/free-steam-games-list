import { describe, expect, it } from "vitest";
import { byCodeUnit } from "./sort";

describe("byCodeUnit", () => {
  it("orders by UTF-16 code unit, as a bare sort() does", () => {
    const words = ["b", "a", "B", "é", "e", "_app/x.js", "Z", "10", "9", "", "a"];
    expect([...words].sort(byCodeUnit)).toEqual(["", "10", "9", "B", "Z", "_app/x.js", "a", "a", "b", "e", "é"]);
  });

  it("is a consistent comparator", () => {
    expect(byCodeUnit("a", "a")).toBe(0);
    expect(byCodeUnit("a", "b")).toBe(-1);
    expect(byCodeUnit("b", "a")).toBe(1);
  });
});
