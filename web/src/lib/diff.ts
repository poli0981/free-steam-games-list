/**
 * A line diff, for showing what changed in a legal document.
 *
 * Scope is deliberately small: two markdown files of a few kilobytes, rendered
 * as plain text. That is why this is ~80 lines of LCS rather than a
 * dependency - jsdiff would be the right answer for source control, and is
 * three times the size of the documents it would be diffing here.
 *
 * Output is TEXT, never HTML. The consent gate renders it in a <pre>: the
 * documents are repository content, but a diff view that interpreted markup
 * would be a way to put markup in front of someone at the exact moment they
 * are being asked to agree to something.
 */

export type DiffKind = "add" | "del" | "context";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/** One run of changes with a little unchanged text around it. */
export interface DiffHunk {
  /** 1-based line number in the NEW text where this hunk starts. */
  start: number;
  lines: DiffLine[];
}

/** Unchanged lines kept on each side of a change, so a hunk reads in context. */
const CONTEXT = 2;

/**
 * Longest common subsequence, the O(n·m) table.
 *
 * Fine at this size: the largest binding document is ~150 lines, so the table
 * is a few thousand cells. It would not be fine on a 10,000-line file, and
 * nothing here should ever be pointed at one.
 */
function lcsLengths(a: string[], b: string[]): Uint32Array[] {
  const table: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    const row = table[i]!;
    const next = table[i + 1]!;
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }
  return table;
}

/** Every line of both texts, tagged. Line endings normalised first, so a file
 *  that arrived with CRLF does not read as "every line changed". */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  const table = lcsLengths(a, b);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  for (; i < a.length; i++) out.push({ kind: "del", text: a[i]! });
  for (; j < b.length; j++) out.push({ kind: "add", text: b[j]! });
  return out;
}

/**
 * The same diff, reduced to the parts worth reading: each run of changes plus
 * CONTEXT unchanged lines either side. A document whose licence block is
 * untouched should not make someone scroll past it again - that is the whole
 * point of this feature.
 */
export function diffHunks(before: string, after: string): DiffHunk[] {
  const lines = diffLines(before, after);
  const changed = lines.map((l) => l.kind !== "context");
  if (!changed.includes(true)) return [];

  // Which indexes to keep: every change, and CONTEXT lines around each.
  const keep = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!changed[i]) continue;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) keep.add(k);
  }

  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  // Line numbers count the NEW text, so they match what /legal/<slug> shows.
  let newLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.kind !== "del") newLine++;
    if (!keep.has(i)) {
      current = null;
      continue;
    }
    if (!current) {
      current = { start: Math.max(1, newLine), lines: [] };
      hunks.push(current);
    }
    current.lines.push(line);
  }
  return hunks;
}

/** `+ added` / `- removed` / `  unchanged`, one line per entry. For a <pre>. */
export function formatHunk(hunk: DiffHunk): string {
  const marker: Record<DiffKind, string> = { add: "+ ", del: "- ", context: "  " };
  return hunk.lines.map((l) => marker[l.kind] + l.text).join("\n");
}
