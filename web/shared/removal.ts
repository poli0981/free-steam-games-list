/**
 * The removal blocklist's rules, in ONE place, imported by the Worker
 * (worker/routes/remove.ts) and the admin SPA (admin/src/views/RemoveView).
 *
 * data/blocklist.jsonl is a standing instruction in Git, like an override:
 * scripts/core/blocklist.py reads it and save_main() leaves every listed game
 * out of every write. The Worker appends lines (Remove) and deletes one
 * (Restore); scripts/delete_game.py appends too. Neither ever re-serialises a
 * line it did not write, and both write the same bytes for the same entry -
 * scripts/tests/fixtures/blocklist_golden.jsonl holds that, from both sides.
 *
 * Pure: no DOM, no Env, no I/O.
 */

export const BLOCKLIST_PATH = "data/blocklist.jsonl";

/** Games one removal may name: bounds the commit, the D1 batch and a mis-click. */
export const MAX_REMOVE = 100;

export const MAX_NOTE = 300;

/** ingest_decisions.reason prefix that marks a removal rather than a rejection. */
export const REMOVED_DECISION_PREFIX = "removed:";

/** Written into every line instead of a person: the file is public forever. */
const ATTRIBUTION = "admin";

/**
 * Reason codes and the words the public removed-games log shows. Mirrors
 * REASONS in scripts/core/blocklist.py (removal.test.ts reads that file and
 * compares): a code Python does not know would make the line block nothing.
 */
export const REMOVAL_REASONS = {
  not_free: "No longer free to play",
  not_a_game: "Not a game (DLC, demo, tool or soundtrack)",
  duplicate: "Duplicate entry",
  broken: "Unplayable or shut down",
  inappropriate: "Does not fit the catalogue",
  other: "Other",
} as const;

export type RemovalReason = keyof typeof REMOVAL_REASONS;

export const REMOVAL_REASON_CODES = Object.keys(REMOVAL_REASONS) as RemovalReason[];

export function isRemovalReason(value: unknown): value is RemovalReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REMOVAL_REASONS, value);
}

export interface BlocklistEntry {
  appid: string;
  link: string;
  name: string;
  reason: RemovalReason;
  note: string;
  blocked_at: string;
  by: string;
}

const ENTRY_KEYS = ["appid", "link", "name", "reason", "note", "blocked_at", "by"] as const;

const APPID_RE = /^\d{1,10}$/;
const ISO_SECONDS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function canonicalLink(appid: string): string {
  return `https://store.steampowered.com/app/${appid}/`;
}

/**
 * now_iso()'s shape: no milliseconds. dedup_removed() compares removed_at as a
 * string, and the pipeline's own lines carry whole seconds.
 */
export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * A one-line text: control characters and line breaks (U+2028/U+2029 too)
 * become spaces, whitespace runs collapse, at most `limit` characters.
 * clean_text() in scripts/core/blocklist.py is the same rule.
 */
export function cleanText(value: string | null | undefined, limit: number): string {
  let out = "";
  for (const ch of value ?? "") {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || (c >= 0x7f && c < 0xa0) || ch === "\u2028" || ch === "\u2029" ? " " : ch;
  }
  // Python's str.split() whitespace, which is \s without U+FEFF.
  const words = out.split(/[^\S\uFEFF]+/).filter(Boolean);
  return Array.from(words.join(" ")).slice(0, limit).join("");
}

/** Why a parsed line cannot be honoured, or null. entry_problem() in Python. */
export function entryProblem(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "not an object";
  const e = entry as Record<string, unknown>;
  if (typeof e.appid !== "string" || !APPID_RE.test(e.appid)) return "appid must be 1-10 digits, as a string";
  if (typeof e.blocked_at !== "string" || !ISO_SECONDS_RE.test(e.blocked_at)) {
    return "blocked_at must look like 2026-10-13T12:00:00Z";
  }
  if (!isRemovalReason(e.reason)) return `reason must be one of ${REMOVAL_REASON_CODES.join(", ")}`;
  for (const key of ["link", "name", "note"]) {
    if (e[key] !== undefined && typeof e[key] !== "string") return `${key} must be a string`;
  }
  return null;
}

export function makeEntry(
  appid: string,
  name: string,
  reason: RemovalReason,
  note: string,
  blockedAt: string,
  link?: string,
): BlocklistEntry {
  const entry: BlocklistEntry = {
    appid,
    link: link || canonicalLink(appid),
    name: cleanText(name, 300),
    reason,
    note: cleanText(note, MAX_NOTE),
    blocked_at: blockedAt,
    by: ATTRIBUTION,
  };
  const problem = entryProblem(entry);
  if (problem) throw new Error(problem);
  return entry;
}

/**
 * One line, without its newline: keys in a fixed order, compact separators,
 * non-ASCII as is - except U+2028/U+2029, escaped, because str.splitlines()
 * and some editors treat them as line breaks. serialize_entry() in Python.
 */
export function serializeEntry(entry: BlocklistEntry): string {
  const ordered: Record<string, string> = {};
  for (const key of ENTRY_KEYS) ordered[key] = String(entry[key] ?? "");
  return JSON.stringify(ordered).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** appid -> entry for every line that can be honoured; the LAST one wins. */
export function parseBlocklist(text: string): Map<string, BlocklistEntry> {
  const out = new Map<string, BlocklistEntry>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (entryProblem(parsed)) continue;
    const e = parsed as BlocklistEntry;
    out.set(e.appid, {
      appid: e.appid,
      link: e.link || canonicalLink(e.appid),
      name: e.name ?? "",
      reason: e.reason,
      note: e.note ?? "",
      blocked_at: e.blocked_at,
      by: e.by ?? "",
    });
  }
  return out;
}

/** The file with `entries` appended. Existing bytes are kept exactly. */
export function appendEntries(text: string, entries: BlocklistEntry[]): string {
  if (!entries.length) return text;
  const sep = text && !text.endsWith("\n") ? "\n" : "";
  return text + sep + entries.map(serializeEntry).join("\n") + "\n";
}

/**
 * The file without the lines for `appid`, and how many were dropped. Every
 * other line - a malformed one included - is kept byte for byte: this is not
 * the place to repair anything.
 */
export function withoutAppid(text: string, appid: string): { text: string; removed: number } {
  let removed = 0;
  const kept = text.split("\n").filter((line) => {
    if (!line.trim()) return true;
    try {
      const parsed = JSON.parse(line) as { appid?: unknown };
      if (parsed && typeof parsed === "object" && parsed.appid === appid) {
        removed++;
        return false;
      }
    } catch {
      /* not ours to judge */
    }
    return true;
  });
  return { text: kept.join("\n"), removed };
}

/** The reason the public removed-games log shows (the note stays out of it). */
export function publicReason(reason: string): string {
  const label = isRemovalReason(reason) ? REMOVAL_REASONS[reason] : "Other";
  return `Removed by the maintainer: ${label}`;
}

/**
 * Appids out of pasted text: store links, steamdb/steamcommunity links,
 * anything with /app/<id>, or bare numbers, separated by whitespace, commas or
 * semicolons. Order kept, duplicates dropped; the rest comes back as invalid.
 */
export function parseAppidList(text: string): { appids: string[]; invalid: string[] } {
  const appids: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    const id = /^\d{1,10}$/.test(token) ? token : (/\/app\/(\d{1,10})(?!\d)/.exec(token)?.[1] ?? null);
    if (!id) invalid.push(token);
    else if (!appids.includes(id)) appids.push(id);
  }
  return { appids, invalid };
}
