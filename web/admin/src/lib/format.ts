const REPO = "https://github.com/poli0981/free-steam-games-list";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "3 hours ago". The ISO string belongs in a title attribute beside it. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const seconds = Math.round((ms - now) / 1000);
  for (const [unit, per] of UNITS) {
    if (Math.abs(seconds) >= per) return rtf.format(Math.round(seconds / per), unit);
  }
  return "just now";
}

/** "2026-09-17 12:04 UTC" - for tooltips and exact records. */
export function exactTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function formatInt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

/** "1 row", "3 rows". */
export function plural(n: number, word: string): string {
  return `${formatInt(n)} ${word}${n === 1 ? "" : "s"}`;
}

/** An override or catalogue value as the reviewer should read it. */
export function showValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  return JSON.stringify(value);
}

export const shortSha = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : "—");
export const commitUrl = (sha: string): string => `${REPO}/commit/${sha}`;
export const steamUrl = (appid: string): string => `https://store.steampowered.com/app/${appid}/`;
export const fileUrl = (path: string): string => `${REPO}/blob/main/${path}`;

/** Pretty JSON for display, or the raw text when it does not parse. */
export function prettyJson(text: string | null | undefined): string {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * The languages a candidate's payload lists: English names, as discovery read
 * them from appdetails. `null` when there is no list - rows queued before
 * discovery took games in every language (v4.6.0), or a payload that does not
 * parse - which is not the same as `[]`, a game that declares no language.
 */
export function payloadLanguages(text: string | null | undefined): string[] | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = (parsed as { languages?: unknown } | null)?.languages;
  if (!Array.isArray(list)) return null;
  return list.filter((l): l is string => typeof l === "string");
}

/** The languages as the candidate dialog shows them. */
export function languagesLabel(languages: string[] | null): string {
  if (languages === null) return "—";
  return languages.length ? languages.join(", ") : "none declared";
}

/** A known list without English: a reader of English cannot play the game. */
export const lacksEnglish = (languages: string[] | null): boolean =>
  languages !== null && !languages.includes("English");

/** "1-50 of 646" for a pager. */
export function rangeLabel(offset: number, count: number, total: number): string {
  if (!total || !count) return `0 of ${formatInt(total)}`;
  return `${formatInt(offset + 1)}–${formatInt(offset + count)} of ${formatInt(total)}`;
}
