import { describe, expect, it } from "vitest";
import { diffHunks, diffLines, formatHunk } from "./diff";

const text = (...lines: string[]) => lines.join("\n");

describe("diffLines", () => {
  it("returns only context when nothing changed", () => {
    const out = diffLines(text("a", "b"), text("a", "b"));
    expect(out.every((l) => l.kind === "context")).toBe(true);
  });

  it("marks an insertion", () => {
    expect(diffLines(text("a", "c"), text("a", "b", "c"))).toEqual([
      { kind: "context", text: "a" },
      { kind: "add", text: "b" },
      { kind: "context", text: "c" },
    ]);
  });

  it("marks a deletion", () => {
    expect(diffLines(text("a", "b", "c"), text("a", "c"))).toEqual([
      { kind: "context", text: "a" },
      { kind: "del", text: "b" },
      { kind: "context", text: "c" },
    ]);
  });

  it("marks a replacement as a deletion and an insertion", () => {
    const out = diffLines(text("a", "old", "c"), text("a", "new", "c"));
    expect(out.map((l) => l.kind)).toEqual(["context", "del", "add", "context"]);
  });

  it("reconstructs both inputs from its own output", () => {
    const before = text("one", "two", "three", "four");
    const after = text("one", "2", "three", "four", "five");
    const out = diffLines(before, after);
    expect(out.filter((l) => l.kind !== "add").map((l) => l.text).join("\n")).toBe(before);
    expect(out.filter((l) => l.kind !== "del").map((l) => l.text).join("\n")).toBe(after);
  });

  it("does not report a CRLF copy as a total rewrite", () => {
    // A checkout that ignored .gitattributes, or a snapshot taken from one.
    expect(diffLines("a\r\nb\r\nc", "a\nb\nc").every((l) => l.kind === "context")).toBe(true);
  });

  it("handles an empty side", () => {
    // An empty document splits to [""] - one empty line, not zero lines - so
    // the round trip is what actually has to hold, not a fixed list of kinds.
    for (const [before, after] of [["", text("a", "b")], [text("a", "b"), ""]]) {
      const out = diffLines(before!, after!);
      expect(out.filter((l) => l.kind !== "add").map((l) => l.text).join("\n")).toBe(before);
      expect(out.filter((l) => l.kind !== "del").map((l) => l.text).join("\n")).toBe(after);
    }
  });
});

describe("diffHunks", () => {
  const long = (n: number, label = "line") => Array.from({ length: n }, (_, i) => `${label} ${i}`);

  it("is empty when the documents match", () => {
    expect(diffHunks(text(...long(20)), text(...long(20)))).toEqual([]);
  });

  it("keeps only the change and its context, not the whole document", () => {
    const before = long(40);
    const after = [...before];
    after[20] = "changed";
    const hunks = diffHunks(text(...before), text(...after));
    expect(hunks).toHaveLength(1);
    // 2 context either side, plus the del and the add.
    expect(hunks[0]!.lines).toHaveLength(6);
    expect(formatHunk(hunks[0]!)).toContain("- line 20");
    expect(formatHunk(hunks[0]!)).toContain("+ changed");
    expect(formatHunk(hunks[0]!)).not.toContain("line 0");
  });

  it("splits distant changes into separate hunks and joins near ones", () => {
    const before = long(60);
    const far = [...before];
    far[5] = "x";
    far[50] = "y";
    expect(diffHunks(text(...before), text(...far))).toHaveLength(2);

    const near = [...before];
    near[5] = "x";
    near[7] = "y";
    expect(diffHunks(text(...before), text(...near))).toHaveLength(1);
  });

  it("numbers hunks by the NEW text, so they match the published document", () => {
    const before = long(20);
    const after = [...before];
    after.splice(10, 0, "inserted");
    const [hunk] = diffHunks(text(...before), text(...after));
    // The insert is the 11th line of the new text; the hunk opens 2 above it.
    expect(hunk!.start).toBe(9);
  });
});

describe("formatHunk", () => {
  it("prefixes every line, so a copy-paste stays readable", () => {
    const [hunk] = diffHunks(text("keep", "old", "keep2"), text("keep", "new", "keep2"));
    expect(formatHunk(hunk!)).toBe(["  keep", "- old", "+ new", "  keep2"].join("\n"));
  });
});
