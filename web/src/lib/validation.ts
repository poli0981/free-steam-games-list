/**
 * Per-record validation rules for inline badges in GamesTable.
 *
 * Same buckets as the Health page but distilled into a small "issues" array
 * we can render as a chip or tooltip per row.
 */
import type { GameRecord } from "./schema";

export interface ValidationIssue {
  code: "missing-genre" | "missing-type" | "missing-safe" | "stale" | "kernel-unknown";
  label: string;
}

const STALE_DAYS = 30;

export function recordIssues(r: GameRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!r.genre || r.genre === "-") issues.push({ code: "missing-genre", label: "no genre" });
  if (!r.type_game) issues.push({ code: "missing-type", label: "no type" });
  if (!r.safe || r.safe === "?") issues.push({ code: "missing-safe", label: "safe?" });
  if (r.last_updated) {
    const age = (Date.now() - new Date(r.last_updated).getTime()) / 86_400_000;
    if (Number.isFinite(age) && age > STALE_DAYS)
      issues.push({ code: "stale", label: `${Math.floor(age)}d stale` });
  }
  if (
    r.type_game === "online" &&
    r.is_kernel_ac == null &&
    r.anti_cheat &&
    r.anti_cheat !== "-"
  ) {
    issues.push({ code: "kernel-unknown", label: "kernel?" });
  }
  return issues;
}
