/**
 * What /admin/quality counts, per catalogue record. Pure, shared by the Worker
 * (lib/records.ts computes the issues once per dataset generation) and the
 * admin SPA (labels and grouping).
 *
 * Three kinds of check, because they call for different hands:
 *   review   a judgement only a person makes (the Edit page, as an override)
 *   edit     a manual field left empty (the Edit page)
 *   scraped  a field the pipeline fills; Refresh Store Data retries these on
 *            its own, so they are for watching, not for typing in by hand
 *   info     states the pipeline sets (dead, delisted), listed for reference
 */

export type SafeClass = "y" | "n" | "?" | "";

/**
 * `safe` as the public app classifies it - a copy of safeClass() in
 * web/src/lib/safety.ts, held equal by quality.test.ts (the admin build cannot
 * import $lib).
 */
export function safeClass(value: unknown): SafeClass {
  const v = (typeof value === "string" ? value : "").trim().toLowerCase();
  if (v === "y" || v === "yes") return "y";
  if (v === "n" || v === "no") return "n";
  if (v === "") return "";
  return "?";
}

export const QUALITY_CHECKS = [
  { key: "safe-unset", group: "review", label: "Safety never set", hint: "safe is empty" },
  { key: "safe-unreviewed", group: "review", label: "Safety not reviewed", hint: "safe is \"?\" - the review backlog" },
  { key: "kernel-unknown", group: "review", label: "Kernel anti-cheat unknown", hint: "online, with a named anti-cheat, is_kernel_ac not set" },
  { key: "online-no-anticheat", group: "edit", label: "Online, anti-cheat never set", hint: "anti_cheat is empty (\"-\" means none and is fine)" },
  { key: "no-genre", group: "edit", label: "No genre", hint: "genre is empty" },
  { key: "no-type", group: "edit", label: "Online/offline not set", hint: "type_game is empty" },
  { key: "no-header", group: "scraped", label: "No header image", hint: "header_image is empty" },
  { key: "no-description", group: "scraped", label: "No description", hint: "description is empty" },
  { key: "no-tags", group: "scraped", label: "No tags", hint: "tags is empty" },
  { key: "no-languages", group: "scraped", label: "No languages", hint: "languages or language_details is empty" },
  { key: "no-developer", group: "scraped", label: "No developer", hint: "developer is empty" },
  { key: "no-publisher", group: "scraped", label: "No publisher", hint: "publisher is empty" },
  { key: "no-release-date", group: "scraped", label: "No release date", hint: "release_date is empty" },
  { key: "dead", group: "info", label: "Dead (no players for 14+ days)", hint: "is_dead is true" },
  { key: "delisted", group: "info", label: "Store page gone", hint: "status is delisted" },
] as const;

export type QualityCheck = (typeof QUALITY_CHECKS)[number]["key"];
export type QualityGroup = (typeof QUALITY_CHECKS)[number]["group"];

export const QUALITY_GROUPS: { key: QualityGroup; label: string }[] = [
  { key: "review", label: "Needs a judgement" },
  { key: "edit", label: "Manual field left empty" },
  { key: "scraped", label: "Missing store data (the pipeline retries these)" },
  { key: "info", label: "For reference" },
];

export function isQualityCheck(value: unknown): value is QualityCheck {
  return typeof value === "string" && QUALITY_CHECKS.some((c) => c.key === value);
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const noItems = (v: unknown) =>
  !Array.isArray(v) || v.every((x) => blank(x) || (typeof x === "object" && x !== null && Object.keys(x).length === 0));

/** Every check one record fails, in QUALITY_CHECKS order. */
export function qualityIssues(rec: Record<string, unknown>): QualityCheck[] {
  const out: QualityCheck[] = [];
  const safe = safeClass(rec.safe);
  if (safe === "") out.push("safe-unset");
  else if (safe === "?") out.push("safe-unreviewed");
  const online = rec.type_game === "online";
  const ac = typeof rec.anti_cheat === "string" ? rec.anti_cheat.trim() : "";
  if (online && ac && ac !== "-" && (rec.is_kernel_ac === null || rec.is_kernel_ac === undefined)) out.push("kernel-unknown");
  if (online && blank(rec.anti_cheat)) out.push("online-no-anticheat");
  if (blank(rec.genre)) out.push("no-genre");
  if (blank(rec.type_game)) out.push("no-type");
  if (blank(rec.header_image)) out.push("no-header");
  if (blank(rec.description)) out.push("no-description");
  if (noItems(rec.tags)) out.push("no-tags");
  if (noItems(rec.languages) || noItems(rec.language_details)) out.push("no-languages");
  if (noItems(rec.developer)) out.push("no-developer");
  if (noItems(rec.publisher)) out.push("no-publisher");
  if (blank(rec.release_date)) out.push("no-release-date");
  if (rec.is_dead === true) out.push("dead");
  if (rec.status === "delisted") out.push("delisted");
  return out;
}
