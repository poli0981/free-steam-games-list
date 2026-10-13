/**
 * Auto-approve's settings and limits, in ONE place: the Worker's runner
 * (worker/lib/auto-approve.ts) and the admin page (AutomationView) both import
 * them, so the form cannot offer what the server would refuse.
 *
 * Pure: no DOM, no Env, no I/O.
 */
import { MAX_DECIDE } from "./queue-rules";

/** admin_state keys. */
export const AUTO_SETTINGS_KEY = "auto.approve.settings";
export const AUTO_LAST_KEY = "auto.approve.last";
export const AUTO_COUNT_PREFIX = "auto.approve.count:";

/** D1 actor for a scheduled batch (a run from the page uses the person's identity). */
export const AUTO_ACTOR = "auto-approve";

/**
 * Hard ceiling on games auto-approved per UTC day. In code, not a wrangler var
 * (a deploy resets dashboard vars), and re-applied when a run reads its
 * settings, so no stored value can exceed it.
 */
export const AUTO_DAILY_CEILING = 500;
export const AUTO_MAX_SOURCES = 10;
export const AUTO_MAX_AGE_HOURS = 168;

export const AUTO_ORDERS = ["oldest", "newest", "players"] as const;
export type AutoOrder = (typeof AUTO_ORDERS)[number];

export const AUTO_ORDER_LABEL: Record<AutoOrder, string> = {
  oldest: "Oldest first (first come, first served)",
  newest: "Newest first",
  players: "Most players first",
};

export interface AutoSettings {
  enabled: boolean;
  /** Games per commit; one batch is in flight at a time. */
  batchSize: number;
  /** Games per UTC day, at most AUTO_DAILY_CEILING. */
  dailyLimit: number;
  /** Queue sources to take from; [] means every source. "backfill:*" matches a prefix. */
  sources: string[];
  /** Only rows that have waited at least this long, so a person can look first. */
  minAgeHours: number;
  order: AutoOrder;
}

export const AUTO_DEFAULTS: AutoSettings = {
  enabled: false,
  batchSize: MAX_DECIDE,
  dailyLimit: 300,
  sources: [],
  minAgeHours: 0,
  order: "oldest",
};

/** What the last scheduled or manual run did (admin_state AUTO_LAST_KEY). No identities. */
export interface AutoLast {
  at: string;
  outcome: "approved" | "skipped" | "failed";
  detail: string;
  count?: number;
  sha?: string | null;
  manual?: boolean;
}

/** The per-day counter key, by UTC date. */
export function autoCountKey(now: Date): string {
  return AUTO_COUNT_PREFIX + now.toISOString().slice(0, 10);
}

const SOURCE_RE = /^[A-Za-z0-9:._-]{1,40}\*?$/;

function int(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** Settings from a request body, or why not. Every field is required. */
export function validateSettings(input: unknown): { ok: true; settings: AutoSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "settings must be an object" };
  const x = input as Record<string, unknown>;
  if (typeof x.enabled !== "boolean") return { ok: false, error: "enabled must be true or false" };
  const batchSize = int(x.batchSize, 1, MAX_DECIDE);
  if (batchSize === null) return { ok: false, error: `batchSize must be a whole number from 1 to ${MAX_DECIDE}` };
  const dailyLimit = int(x.dailyLimit, 1, AUTO_DAILY_CEILING);
  if (dailyLimit === null) return { ok: false, error: `dailyLimit must be a whole number from 1 to ${AUTO_DAILY_CEILING}` };
  const minAgeHours = int(x.minAgeHours, 0, AUTO_MAX_AGE_HOURS);
  if (minAgeHours === null) return { ok: false, error: `minAgeHours must be a whole number from 0 to ${AUTO_MAX_AGE_HOURS}` };
  if (!(AUTO_ORDERS as readonly unknown[]).includes(x.order)) return { ok: false, error: `order must be one of ${AUTO_ORDERS.join(", ")}` };
  if (!Array.isArray(x.sources)) return { ok: false, error: "sources must be a list" };
  const sources = [...new Set(x.sources)];
  if (sources.length > AUTO_MAX_SOURCES) return { ok: false, error: `at most ${AUTO_MAX_SOURCES} sources` };
  for (const s of sources) {
    if (typeof s !== "string" || !SOURCE_RE.test(s)) {
      return { ok: false, error: "a source is letters, digits and : . _ - (up to 40), optionally ending in *" };
    }
  }
  return {
    ok: true,
    settings: { enabled: x.enabled, batchSize, dailyLimit, minAgeHours, order: x.order as AutoOrder, sources: sources as string[] },
  };
}

/**
 * The stored settings, or the defaults. A value that no longer validates
 * (edited by hand, or written by a future version) falls back to the
 * defaults - which are OFF - rather than to whatever part of it parsed.
 */
export function parseSettings(stored: string | null | undefined): AutoSettings {
  if (!stored) return { ...AUTO_DEFAULTS };
  try {
    const out = validateSettings(JSON.parse(stored));
    return out.ok ? out.settings : { ...AUTO_DEFAULTS };
  } catch {
    return { ...AUTO_DEFAULTS };
  }
}

/** Whether a queue row's source is one the settings take from. */
export function sourceMatches(source: string, patterns: string[]): boolean {
  if (!patterns.length) return true;
  return patterns.some((p) => (p.endsWith("*") ? source.startsWith(p.slice(0, -1)) : source === p));
}
