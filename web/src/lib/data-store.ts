/**
 * Data store helpers — port of scripts/core/data_store.py (read-side).
 * Pure functions, no I/O. Used by hooks and components.
 */
import { SKELETON_TEMPLATE, type GameRecord } from "./schema";

const APPID_RE = /\/app\/(\d+)/;
const EMPTY_STRINGS = new Set(["", "N/A", "-", "?"]);

export function extractAppid(link: string | undefined | null): string | null {
  if (!link) return null;
  const m = APPID_RE.exec(link);
  return m ? m[1] : null;
}

export function normalizeLink(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return `https://store.steampowered.com/app/${trimmed}/`;
  }
  const appid = extractAppid(trimmed);
  return appid ? `https://store.steampowered.com/app/${appid}/` : null;
}

export function isEmpty(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string") return EMPTY_STRINGS.has(val.trim());
  if (Array.isArray(val)) return val.length === 0;
  return false;
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function makeSkeleton(link: string): GameRecord {
  const rec: GameRecord = JSON.parse(JSON.stringify(SKELETON_TEMPLATE));
  rec.link = link;
  rec.added_at = nowIso();
  return rec;
}

/** Build appid → record-index map. O(n). */
export function buildIndex(games: GameRecord[]): Map<string, number> {
  const idx = new Map<string, number>();
  for (let i = 0; i < games.length; i++) {
    const aid = extractAppid(games[i].link);
    if (aid) idx.set(aid, i);
  }
  return idx;
}

/** Migrate legacy record shapes. Idempotent. */
export function migrateRecord(game: Record<string, unknown>): GameRecord {
  const out: Record<string, unknown> = { ...game };

  for (const [key, def] of Object.entries(SKELETON_TEMPLATE)) {
    if (!(key in out)) {
      out[key] = Array.isArray(def) ? [] : def;
    }
  }

  for (const key of ["developer", "publisher"] as const) {
    const v = out[key];
    if (typeof v === "string") {
      out[key] = v
        ? v.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    } else if (!Array.isArray(v)) {
      out[key] = [];
    }
  }

  if ("desc" in out) {
    if (out.desc && isEmpty(out.description)) {
      out.description = out.desc;
    }
    delete out.desc;
  }

  for (const k of [
    "free_type",
    "is_free",
    "is_dlc",
    "is_demo",
    "is_playtest",
    "price",
    "auto_notes",
  ]) {
    delete out[k];
  }

  return out as unknown as GameRecord;
}

/** Get the appid the way the rest of the app expects it. */
export function appidOf(game: GameRecord): string {
  return extractAppid(game.link) ?? "";
}

/** Compute which shard (1-based) holds the i-th record given MAX_PER_FILE. */
export function shardForIndex(i: number, maxPerFile: number): number {
  return Math.floor(i / maxPerFile) + 1;
}

export function shardName(idx: number): string {
  return `data_${String(idx).padStart(3, "0")}.jsonl`;
}
