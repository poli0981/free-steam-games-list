/**
 * Canonicalising the free-text `anti_cheat` field.
 *
 * Mirrors `ANTI_CHEAT_PATTERNS` in `scripts/core/constants.py`. The field is a
 * human judgement written by hand, so "EasyAntiCheat", "Easy Anti-Cheat" and
 * "easy anti cheat" all occur and all mean the same product. Keep the two in
 * sync: a pattern added on the Python side and not here means the chart shows
 * an "Other" slice for something the pipeline already classifies.
 *
 * Lifted out of AntiCheatList.tsx so the list page and the stacked chart
 * bucket identically — they previously each had their own copy of the table,
 * which is how two views of the same field come to disagree.
 */
import { ANTI_CHEAT_ENUM } from "./enums";
import type { GameRecord } from "./schema";

const AC_PATTERNS: Record<string, string[]> = {
  VAC: ["valve anti-cheat", "valve anti cheat", "vac enabled"],
  EAC: ["easy anti-cheat", "easy anti cheat", "easyanticheat"],
  BattlEye: ["battleye", "battle eye"],
  Vanguard: ["vanguard", "riot vanguard"],
  PunkBuster: ["punkbuster", "punk buster"],
  nProtect: ["nprotect", "gameguard"],
  XIGNCODE: ["xigncode", "xigncode3"],
  Ricochet: ["ricochet anti-cheat", "ricochet"],
  mHyprot: ["mhyprot", "mhyprot2"],
  "FACEIT AC": ["faceit anti-cheat", "faceit ac"],
  "Denuvo AC": ["denuvo anti-cheat"],
  KSS: ["kss", "krafton security"],
  "NetEase GS": ["netease game security"],
  Hyperion: ["hyperion", "byfron"],
};

/** "-" is the skeleton default meaning "none recorded", not a product. */
export const CANONICAL_ORDER = ANTI_CHEAT_ENUM.filter((k) => k !== "-");

export function canonicalAc(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === "-" || s === "none" || s === "no" || s === "n/a") return null;
  for (const name of CANONICAL_ORDER) {
    if (s.includes(name.toLowerCase())) return name;
    for (const p of AC_PATTERNS[name] ?? []) {
      if (s.includes(p)) return name;
    }
  }
  return "Other";
}

export interface AcBucket {
  key: string;
  games: GameRecord[];
}

/** Games grouped by canonical anti-cheat, biggest bucket first, with "Other"
 *  pinned last however large it is — it is a residual, not a product. */
export function bucketByAntiCheat(records: GameRecord[]): AcBucket[] {
  const map = new Map<string, GameRecord[]>();
  for (const r of records) {
    const key = canonicalAc(r.anti_cheat);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, games]) => ({ key, games }))
    .sort((a, b) => {
      if (a.key === "Other") return 1;
      if (b.key === "Other") return -1;
      return b.games.length - a.games.length;
    });
}

/**
 * Kernel / user-mode / none, per game.
 *
 * `is_kernel_ac` is tri-state on purpose: `null` means nobody has checked, and
 * folding it into `false` would claim a game is user-mode when the honest
 * answer is "unknown". The chart keeps it separate.
 */
export type AcLevel = "kernel" | "user" | "unknown" | "none";

export function acLevel(r: GameRecord): AcLevel {
  if (!canonicalAc(r.anti_cheat)) return "none";
  if (r.is_kernel_ac === true) return "kernel";
  if (r.is_kernel_ac === false) return "user";
  return "unknown";
}
