/**
 * The `safe` field's classes, in a module of their own so the pages that
 * count them do not pull the search index in with them.
 */

/**
 * `safe` as a reader can filter it.
 *
 *   y   reviewed and safe          n   reviewed and not safe
 *   ?   explicitly not reviewed    ""  never filled in
 *
 * It is a hand-entered field, so it is normalised first: the data carries at
 * least one "yes", and an unrecognised value counts as not reviewed rather
 * than vanishing from every option. The /stats chart uses the same rule.
 */
export type SafeClass = "y" | "n" | "?" | "";

export function safeClass(value: string | null | undefined): SafeClass {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "y" || v === "yes") return "y";
  if (v === "n" || v === "no") return "n";
  if (v === "") return "";
  return "?";
}
