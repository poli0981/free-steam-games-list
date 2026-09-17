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

/* ────────────────────────── call sites ────────────────────────── */

/**
 * The checks above prove a key EXISTS. None of them noticed the key being used
 * wrongly, which is how v4.0.0 shipped seven visible placeholders:
 * "Languages ({{count}})", "(PEAK {{PEAK}})" as a field label, "(peak
 * {{peak}})" as a chart axis, "appid {{appid}} · open on Steam" on every table
 * row, and a prerendered meta description reading "{{total}} active games".
 *
 * These read every call site. Comments are stripped first so prose that
 * mentions a key is not mistaken for a call.
 */
function stripComments(text: string): string {
  // Until nothing changes: a single pass over "<!-<!-- -->-" leaves a "<!--"
  // behind (CodeQL js/incomplete-multi-character-sanitization).
  let html = text;
  for (let previous = ""; previous !== html; ) {
    previous = html;
    html = html.replace(/<!--[\s\S]*?-->/g, "");
  }
  return html
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // A line comment, but not the "//" inside "https://".
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
}

type CallArgs =
  | { kind: "none" }
  | { kind: "other" }
  | { kind: "object"; keys: Set<string>; spread: boolean };

/** Skip a quoted string starting at `i`; returns the index of its closing quote. */
function skipString(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== quote) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (quote === "`" && src[j] === "$" && src[j + 1] === "{") {
      let depth = 1;
      j += 2;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      continue;
    }
    j++;
  }
  return j;
}

/** Top-level property names of the object literal whose `{` is at `start`. */
function objectKeys(src: string, start: number): { keys: Set<string>; spread: boolean } {
  const keys = new Set<string>();
  let spread = false;
  let depth = 0;
  let expectKey = true;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") {
      j = skipString(src, j);
      expectKey = false;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") {
      depth++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    if (c === ",") {
      expectKey = true;
      continue;
    }
    if (/\s/.test(c) || !expectKey) continue;
    if (src.startsWith("...", j)) {
      spread = true;
      expectKey = false;
      j += 2;
      continue;
    }
    const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(j, j + 80));
    if (m) {
      let k = j + m[0].length;
      while (/\s/.test(src[k] ?? "")) k++;
      if ([":", ",", "}", "("].includes(src[k] ?? "")) keys.add(m[0]);
      j = k - 1;
    }
    expectKey = false;
  }
  return { keys, spread };
}

function argsAfter(src: string, i: number): CallArgs {
  let j = i;
  while (/\s/.test(src[j] ?? "")) j++;
  if (src[j] === ")") return { kind: "none" };
  if (src[j] !== ",") return { kind: "other" };
  j++;
  while (/\s/.test(src[j] ?? "")) j++;
  if (src[j] !== "{") return { kind: "other" };
  return { kind: "object", ...objectKeys(src, j) };
}

describe("call sites pass what the text needs", () => {
  const sources = walk(SRC).map((file) => ({
    file: file.slice(SRC.length + 1).replace(/\\/g, "/"),
    text: stripComments(readFileSync(file, "utf8")),
  }));

  it("has no template-literal keys", () => {
    // `t(\`errors.${code}.title\`)` cannot be checked by anything in this file,
    // and `t(\`detail.${f.key}\`)` is exactly how a suffix got used as a label.
    // Use a table of literal keys instead.
    const offenders = sources
      .filter(({ text }) => /\bt\(\s*`/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("every placeholder in a literal key's text is supplied", () => {
    const problems: string[] = [];
    const call = /\bt\(\s*"([a-zA-Z][\w.]*)"/g;
    for (const { file, text } of sources) {
      for (const m of text.matchAll(call)) {
        const value = lookup(en as Tree, m[1]);
        if (typeof value !== "string") continue; // reported by the existence test
        const needed = placeholdersOf(value);
        if (!needed.length) continue;
        const args = argsAfter(text, (m.index ?? 0) + m[0].length);
        if (args.kind === "other") continue; // a variable - cannot be read statically
        if (args.kind === "none") {
          problems.push(`${file}: t("${m[1]}") without {${needed.join(", ")}}`);
          continue;
        }
        if (args.spread) continue;
        const missing = needed.filter((n) => !args.keys.has(n));
        if (missing.length) problems.push(`${file}: t("${m[1]}") missing {${missing.join(", ")}}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("a key that carries placeholders is never stored in a lookup table", () => {
    // Tables of literal keys (field labels, legend entries) are rendered with
    // t(entry.label) and no arguments, so a placeholder key in one is a bug.
    const NAMESPACES = Object.keys(en as Tree).join("|");
    const tableEntry = new RegExp(`(?:label|title|desc|description|i18n)\\s*:\\s*"((?:${NAMESPACES})\\.[\\w.]+)"`, "g");
    const problems: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(tableEntry)) {
        const value = lookup(en as Tree, m[1]);
        if (typeof value === "string" && placeholdersOf(value).length) {
          problems.push(`${file}: ${m[1]}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("every key-shaped string literal exists", () => {
    // Catches the tables above: `{ label: "detail.labelGenre" }` never passes
    // through a literal t() call, so the existence test cannot see it.
    const NAMESPACES = Object.keys(en as Tree).join("|");
    const literal = new RegExp(`"((?:${NAMESPACES})\\.[A-Za-z][\\w.]*)"`, "g");
    const FILE_LIKE = /\.(svelte|ts|js|json|css|html|md|svg|png|webp|woff2|jsonl)$/;
    const missing: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(literal)) {
        if (FILE_LIKE.test(m[1])) continue;
        if (typeof lookup(en as Tree, m[1]) !== "string") missing.push(`${file} -> ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/* ────────────────────────── coverage ────────────────────────── */

/**
 * The two ways a locale file rots without anything failing: keys nothing asks
 * for any more (137 of them had piled up by v4.0.0 - the React app's sign-in,
 * GPG, bulk-delete and maintenance-trigger screens, all long gone), and
 * Vietnamese values that are just the English copied across.
 */
describe("locale coverage", () => {
  const source = walk(SRC)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  it("every en key is used by the app", () => {
    // A key is used when it appears as a quoted string anywhere in the source:
    // a literal t() call, or an entry in a table of literal keys (which is the
    // only other form the call-site tests allow). Plural forms are asked for
    // by their base key.
    const unused = leaves(en as Tree).filter((key) => {
      const base = key.replace(/_(zero|one|two|few|many|other)$/, "");
      return ![`"${key}"`, `'${key}'`, `"${base}"`].some((q) => source.includes(q));
    });
    expect(unused).toEqual([]);
  });

  /** Values that are the same in both languages on purpose. */
  const SAME_IN_VI = new Set([
    // Product and brand names.
    "donate.platform.github",
    "donate.platform.kofi",
    "donate.platform.bmc",
    "donate.platform.patreon",
    "donate.platform.paypal",
    "detail.openOnSteamDesktop",
    "detail.labelMetacritic",
    // Terms Vietnamese gaming usage borrows as they are.
    "nav.topOnline",
    "nav.topOffline",
    "nav.antiCheat",
    "nav.drmDlc",
    "detail.labelAntiCheat",
    "detail.labelDrm",
    "common.online",
    "common.offline",
    "antiCheatList.game",
    "studios.oneGame",
    "about.email",
    // Formats and key names.
    "common.page",
    "cmdk.escKey",
  ]);

  it("vi translates every key, apart from names and formats", () => {
    const copied = leaves(en as Tree).filter(
      (key) => !SAME_IN_VI.has(key) && lookup(vi as Tree, key) === lookup(en as Tree, key),
    );
    expect(copied).toEqual([]);
  });

  it("the allowlist only names keys that exist and are still identical", () => {
    const stale = [...SAME_IN_VI].filter(
      (key) => typeof lookup(en as Tree, key) !== "string" || lookup(vi as Tree, key) !== lookup(en as Tree, key),
    );
    expect(stale).toEqual([]);
  });
});
