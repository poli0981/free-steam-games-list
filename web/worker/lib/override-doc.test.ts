/**
 * The parity test docs/ADMIN.md claimed already existed.
 *
 * `scripts/edit_game.py` and `routes/edit.ts` both write
 * `data/overrides/<appid>.json`. If their formatting diverges, every edit that
 * alternates between the CLI and /admin/edit rewrites the whole file, and the
 * diff stops being reviewable.
 *
 * Rather than reimplement Python's json.dump and compare two guesses, this
 * round-trips the REAL committed override files — every one of which was
 * written by Python — through the TypeScript serialiser and asserts the bytes
 * come back byte-for-byte identical. That is the actual property that matters,
 * tested against actual production data rather than a fixture someone wrote to
 * match the implementation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { serialiseOverride } from "./override-doc";

const OVERRIDES_DIR = join(__dirname, "..", "..", "..", "data", "overrides");

describe("override file serialisation", () => {
  const files = existsSync(OVERRIDES_DIR)
    ? readdirSync(OVERRIDES_DIR).filter((f) => f.endsWith(".json"))
    : [];

  it("finds the committed override files to test against", () => {
    // If this ever fails, the round-trip assertions below are vacuously
    // passing over an empty list and the suite is proving nothing.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const name of files) {
    it(`reproduces data/overrides/${name} byte-for-byte`, () => {
      const onDisk = readFileSync(join(OVERRIDES_DIR, name), "utf8");
      const reserialised = serialiseOverride(JSON.parse(onDisk));
      expect(reserialised).toBe(onDisk);
    });
  }

  it("agrees with Python on the shapes that usually diverge", () => {
    // Each of these is a case where a naive serialiser drifts from
    // json.dump(..., ensure_ascii=False, indent=2): empty containers, nested
    // empties, non-ASCII text, and characters JSON must escape.
    const doc = {
      schema: 1,
      appid: "730",
      name: "Counter-Strike 2",
      fields: {},
      retired: {},
      nested: { empty_obj: {}, empty_arr: [] },
      unicode: "Phiêu lưu · 日本語 · emoji 🎮",
      quoting: 'he said "hi"\tand\\or',
    };
    expect(serialiseOverride(doc)).toBe(
      '{\n' +
        '  "schema": 1,\n' +
        '  "appid": "730",\n' +
        '  "name": "Counter-Strike 2",\n' +
        '  "fields": {},\n' +
        '  "retired": {},\n' +
        '  "nested": {\n' +
        '    "empty_obj": {},\n' +
        '    "empty_arr": []\n' +
        '  },\n' +
        '  "unicode": "Phiêu lưu · 日本語 · emoji 🎮",\n' +
        '  "quoting": "he said \\"hi\\"\\tand\\\\or"\n' +
        '}\n',
    );
  });

  it("ends with exactly one trailing newline", () => {
    const out = serialiseOverride({ a: 1 });
    expect(out.endsWith("}\n")).toBe(true);
    expect(out.endsWith("}\n\n")).toBe(false);
  });
});
