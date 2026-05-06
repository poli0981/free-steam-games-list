/**
 * Export the current view (filtered + sorted records) to CSV or JSON.
 * Triggers a client-side download via Blob + anchor click.
 */
import type { GameRecord } from "./schema";

const CSV_COLS: { key: keyof GameRecord; header: string }[] = [
  { key: "link", header: "link" },
  { key: "name", header: "name" },
  { key: "genre", header: "genre" },
  { key: "type_game", header: "type_game" },
  { key: "developer", header: "developer" },
  { key: "publisher", header: "publisher" },
  { key: "release_date", header: "release_date" },
  { key: "reviews", header: "reviews" },
  { key: "current_players", header: "current_players" },
  { key: "peak_today", header: "peak_today" },
  { key: "metacritic", header: "metacritic" },
  { key: "anti_cheat", header: "anti_cheat" },
  { key: "anti_cheat_note", header: "anti_cheat_note" },
  { key: "is_kernel_ac", header: "is_kernel_ac" },
  { key: "platforms", header: "platforms" },
  { key: "languages", header: "languages" },
  { key: "tags", header: "tags" },
  { key: "drm_notes", header: "drm_notes" },
  { key: "has_paid_dlc", header: "has_paid_dlc" },
  { key: "notes", header: "notes" },
  { key: "safe", header: "safe" },
  { key: "status", header: "status" },
  { key: "last_updated", header: "last_updated" },
  { key: "added_at", header: "added_at" },
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (Array.isArray(v)) {
    // Stringify nested objects (e.g. language_details), comma-join scalars.
    s = v.every((x) => typeof x === "string")
      ? v.join(", ")
      : JSON.stringify(v);
  } else if (typeof v === "boolean") {
    s = v ? "true" : "false";
  } else {
    s = String(v);
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function recordsToCsv(records: GameRecord[]): string {
  const header = CSV_COLS.map((c) => c.header).join(",");
  const lines = records.map((r) =>
    CSV_COLS.map((c) => csvCell(r[c.key])).join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export function recordsToJson(records: GameRecord[]): string {
  return JSON.stringify(records, null, 2) + "\n";
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(records: GameRecord[], filename = "f2p-games.csv") {
  downloadBlob(recordsToCsv(records), filename, "text/csv");
}

export function exportJson(records: GameRecord[], filename = "f2p-games.json") {
  downloadBlob(recordsToJson(records), filename, "application/json");
}
