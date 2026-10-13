/**
 * The blocklist line format, held equal on both sides.
 *
 * scripts/tests/fixtures/blocklist_golden.jsonl was written by Python's
 * serialize_entry(); scripts/tests/test_blocklist.py asserts Python reproduces
 * it, and this asserts TypeScript does - escaping, key order and all. Also run
 * by check-overrides.yml, because web-ci only fires for web/**.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendEntries,
  cleanText,
  entryProblem,
  isoSeconds,
  makeEntry,
  parseAppidList,
  parseBlocklist,
  publicReason,
  REMOVAL_REASONS,
  serializeEntry,
  withoutAppid,
  type BlocklistEntry,
} from "./removal";

const REPO = join(__dirname, "..", "..");
const GOLDEN = readFileSync(join(REPO, "scripts", "tests", "fixtures", "blocklist_golden.jsonl"), "utf-8");

describe("serializeEntry", () => {
  const lines = GOLDEN.split("\n").filter(Boolean);

  it("finds the golden lines", () => {
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it("writes every golden line byte for byte, as Python does", () => {
    for (const line of lines) {
      expect(serializeEntry(JSON.parse(line) as BlocklistEntry)).toBe(line);
    }
  });

  it("escapes the two characters that split lines in other tools", () => {
    const line = serializeEntry(makeEntry("1", "x", "other", "", "2026-10-13T12:00:00Z"));
    expect(line).not.toMatch(/[\u2028\u2029]/);
    expect(serializeEntry({ ...JSON.parse(line), note: "a\u2028b\u2029c" })).toContain("a\\u2028b\\u2029c");
  });
});

describe("REMOVAL_REASONS", () => {
  it("is exactly REASONS in scripts/core/blocklist.py", () => {
    const py = readFileSync(join(REPO, "scripts", "core", "blocklist.py"), "utf-8");
    const block = /REASONS: dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(py)?.[1] ?? "";
    const pairs = Object.fromEntries([...block.matchAll(/"([a-z_]+)":\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
    expect(pairs).toEqual(REMOVAL_REASONS);
  });
});

describe("entryProblem / parseBlocklist", () => {
  it("honours only lines the pipeline will", () => {
    const good = serializeEntry(makeEntry("5", "Five", "duplicate", "", "2026-10-13T12:00:00Z"));
    const text = [
      "{not json",
      JSON.stringify({ appid: "1", reason: "not_free" }),
      JSON.stringify({ appid: 2, reason: "not_free", blocked_at: "2026-10-13T12:00:00Z" }),
      JSON.stringify({ appid: "3", reason: "nope", blocked_at: "2026-10-13T12:00:00Z" }),
      JSON.stringify({ appid: "4", reason: "not_free", blocked_at: "2026-10-13T12:00:00.123Z" }),
      good,
      "",
    ].join("\n");
    expect([...parseBlocklist(text).keys()]).toEqual(["5"]);
    expect(entryProblem({ appid: "1", reason: "other", blocked_at: "2026-10-13T12:00:00Z", note: 3 })).toMatch(/note/);
  });

  it("lets the last line for an appid win", () => {
    const a = makeEntry("7", "A", "broken", "", "2026-10-13T12:00:00Z");
    const b = makeEntry("7", "A", "duplicate", "", "2026-10-14T12:00:00Z");
    expect(parseBlocklist(appendEntries(appendEntries("", [a]), [b])).get("7")?.reason).toBe("duplicate");
  });
});

describe("appendEntries / withoutAppid", () => {
  const a = makeEntry("10", "Ten", "broken", "", "2026-10-13T12:00:00Z");
  const b = makeEntry("20", "Twenty", "not_free", "note", "2026-10-13T12:00:01Z");

  it("appends whole lines and keeps what was there", () => {
    expect(appendEntries("", [a])).toBe(serializeEntry(a) + "\n");
    const odd = "{ \"appid\": \"10\" , \"spaced\": true }"; // not ours: kept as is
    expect(appendEntries(odd, [b])).toBe(odd + "\n" + serializeEntry(b) + "\n");
    expect(appendEntries("x\n", [])).toBe("x\n");
  });

  it("removes only the named appid's lines, byte for byte otherwise", () => {
    const text = appendEntries("{broken line\n", [a, b]);
    const out = withoutAppid(text, "10");
    expect(out.removed).toBe(1);
    expect(out.text).toBe("{broken line\n" + serializeEntry(b) + "\n");
    expect(withoutAppid(out.text, "20").text).toBe("{broken line\n");
    expect(withoutAppid(serializeEntry(a) + "\n", "10")).toEqual({ text: "", removed: 1 });
    expect(withoutAppid(text, "99").removed).toBe(0);
  });
});

describe("helpers", () => {
  it("formats timestamps the way now_iso() does", () => {
    expect(isoSeconds(new Date("2026-10-13T12:34:56.789Z"))).toBe("2026-10-13T12:34:56Z");
  });

  it("keeps notes on one line", () => {
    expect(cleanText(" first\nsecond\t\u0001 third\u2028fourth ", 300)).toBe("first second third fourth");
    expect(cleanText("\u{1F3AE}".repeat(5), 3)).toBe("\u{1F3AE}".repeat(3));
    expect(cleanText(null, 10)).toBe("");
  });

  it("names the reason, not the note, in public", () => {
    expect(publicReason("duplicate")).toBe("Removed by the maintainer: Duplicate entry");
    expect(publicReason("bogus")).toBe("Removed by the maintainer: Other");
  });

  it("reads appids out of pasted links", () => {
    expect(
      parseAppidList(
        "730, https://store.steampowered.com/app/440/Team_Fortress_2/\nsteamdb.info/app/570/ 730 junk https://store.steampowered.com/app/12345678901/",
      ),
    ).toEqual({ appids: ["730", "440", "570"], invalid: ["junk", "https://store.steampowered.com/app/12345678901/"] });
  });
});
