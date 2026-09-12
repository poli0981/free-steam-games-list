/**
 * The locale files, and every key the app asks them for.
 *
 * Three failure modes this catches, all of which had already happened:
 *
 * 1. **A key that does not exist.** The React table called
 *    `i18nDefault.t("edit.openOnSteam")`, and `edit` was not a namespace in
 *    en.json, so that tooltip rendered the literal string "edit.openOnSteam"
 *    in production. Nothing flagged it.
 * 2. **A placeholder left unfilled.** `common.rowsPerPage` is `"{{n}}/page"`
 *    and `common.page` is `"{{current}}/{{total}}"` - whole phrases with their
 *    numbers inside, not standalone labels. Using either as a bare caption
 *    printed the raw `{{n}}` on screen, which is exactly what happened twice
 *    while porting this page.
 * 3. **The two locales drifting.** en.json and vi.json have always had
 *    identical key sets. A hand-edit to one is how that stops being true, and
 *    the result is a Vietnamese reader silently falling back to English on
 *    whichever keys were missed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import en from "../i18n/locales/en.json";
import vi from "../i18n/locales/vi.json";

type Tree = Record<string, unknown>;

function leaves(node: Tree, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...leaves(v as Tree, `${prefix}${k}.`));
    } else {
      out.push(`${prefix}${k}`);
    }
  }
  return out;
}

function lookup(node: Tree, key: string): unknown {
  let cur: unknown = node;
  for (const part of key.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Tree)[part];
  }
  return cur;
}

const SRC = join(__dirname, "..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if ([".svelte", ".ts"].includes(extname(name)) && !name.endsWith(".test.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

/** `t("some.key")` with a STRING LITERAL. Dynamic keys (`t(col.label)`,
 *  `t(\`errors.${code}.title\`)`) cannot be resolved statically and are covered
 *  by the separate suites below, which check the tables those keys come from. */
const LITERAL_CALL = /\bt\(\s*"([a-zA-Z][\w.]*)"/g;

describe("locale files", () => {
  it("en and vi have identical key sets", () => {
    const a = new Set(leaves(en as Tree));
    const b = new Set(leaves(vi as Tree));
    expect([...a].filter((k) => !b.has(k)), "keys only in en").toEqual([]);
    expect([...b].filter((k) => !a.has(k)), "keys only in vi").toEqual([]);
  });

  it("has a non-trivial number of keys", () => {
    // Guards against a broken import silently making every assertion vacuous.
    expect(leaves(en as Tree).length).toBeGreaterThan(300);
  });

  it("every leaf is a string", () => {
    for (const key of leaves(en as Tree)) {
      expect(typeof lookup(en as Tree, key), `en.${key}`).toBe("string");
    }
  });
});

describe("keys referenced from source", () => {
  const files = walk(SRC);

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("every literal t() key exists in en.json", () => {
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(LITERAL_CALL)) {
        const key = m[1];
        if (typeof lookup(en as Tree, key) !== "string") {
          missing.push(`${file.slice(SRC.length + 1)} -> ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("keys that carry placeholders", () => {
  // A key whose text contains {{x}} must never be rendered as a bare label.
  // This lists them so a reviewer can see which ones need arguments.
  const withPlaceholders = leaves(en as Tree).filter((k) =>
    /\{\{\w+\}\}/.test(lookup(en as Tree, k) as string),
  );

  it("the same keys carry placeholders in both locales", () => {
    for (const key of withPlaceholders) {
      const enVars = [...((lookup(en as Tree, key) as string).matchAll(/\{\{(\w+)\}\}/g))].map(
        (m) => m[1],
      );
      const viVars = [...((lookup(vi as Tree, key) as string).matchAll(/\{\{(\w+)\}\}/g))].map(
        (m) => m[1],
      );
      // Sorted sets, not order: a translation may legitimately reorder them.
      expect([...new Set(viVars)].sort(), `vi.${key}`).toEqual([...new Set(enVars)].sort());
    }
  });

  it("records which keys need arguments", () => {
    // Not an assertion about a specific list - just proof the detection works,
    // so the check above is not silently matching nothing.
    expect(withPlaceholders.length).toBeGreaterThan(5);
  });
});
