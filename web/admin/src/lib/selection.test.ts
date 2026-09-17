import { describe, expect, it } from "vitest";
import { pageSelection, selectableIds, toggleAll } from "./selection";

const rows = [
  { id: "p1", status: "pending", published: false },
  { id: "p2", status: "pending", published: false },
  { id: "f1", status: "failed", published: false },
  { id: "pub", status: "pending", published: true },
  { id: "a1", status: "approved", published: false },
  { id: "c1", status: "committed", published: true },
  { id: "r1", status: "rejected", published: false },
];

describe("selection", () => {
  it("never offers a decided or published row", () => {
    expect(selectableIds(rows)).toEqual(["p1", "p2", "f1"]);
  });

  it("select-all selects exactly the selectable rows", () => {
    const next = toggleAll(rows, new Set());
    expect([...next].sort()).toEqual(["f1", "p1", "p2"]);
    expect(next.has("pub")).toBe(false);
    expect(next.has("c1")).toBe(false);
  });

  it("counts a page as fully selected without its locked rows", () => {
    expect(pageSelection(rows, new Set(["p1", "p2", "f1"]))).toBe("all");
    expect(pageSelection(rows, new Set(["p1"]))).toBe("some");
    expect(pageSelection(rows, new Set())).toBe("none");
  });

  it("select-all on a full page clears only this page's rows", () => {
    const next = toggleAll(rows, new Set(["p1", "p2", "f1", "elsewhere"]));
    expect([...next]).toEqual(["elsewhere"]);
  });

  it("a page with nothing selectable reads as none, and select-all adds nothing", () => {
    const locked = rows.filter((r) => ["a1", "c1", "r1", "pub"].includes(r.id));
    expect(pageSelection(locked, new Set())).toBe("none");
    expect(toggleAll(locked, new Set()).size).toBe(0);
  });
});
