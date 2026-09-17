/**
 * Per-record validation rules for inline badges in GamesTable.
 *
 * Same buckets as the Health page but distilled into a small "issues" array
 * we can render as a chip or tooltip per row.
 */
import type { GameRecord } from "./schema";
import { safeClass } from "./safety";

export interface ValidationIssue {
  code: "missing-genre" | "missing-type" | "missing-safe" | "stale" | "kernel-unknown";
  /** i18n key, rendered with t(message, vars). These were English strings
   *  ("no genre", "12d stale"), the last untranslated text in the table. */
  message: string;
  vars?: Record<string, string | number>;
}

const STALE_DAYS = 30;

export function recordIssues(r: GameRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!r.genre || r.genre === "-") issues.push({ code: "missing-genre", message: "games.issueNoGenre" });
  if (!r.type_game) issues.push({ code: "missing-type", message: "games.issueNoType" });
  const safe = safeClass(r.safe);
  if (safe === "") issues.push({ code: "missing-safe", message: "games.safeUnset" });
  else if (safe === "?") issues.push({ code: "missing-safe", message: "games.safeUnreviewed" });
  if (r.last_updated) {
    const age = (Date.now() - new Date(r.last_updated).getTime()) / 86_400_000;
    if (Number.isFinite(age) && age > STALE_DAYS) {
      issues.push({ code: "stale", message: "games.issueStale", vars: { days: Math.floor(age) } });
    }
  }
  if (
    r.type_game === "online" &&
    r.is_kernel_ac == null &&
    r.anti_cheat &&
    r.anti_cheat !== "-"
  ) {
    issues.push({ code: "kernel-unknown", message: "games.issueKernelUnknown" });
  }
  return issues;
}
