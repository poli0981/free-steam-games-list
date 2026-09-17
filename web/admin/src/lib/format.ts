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

/** "1-50 of 646" for a pager. */
export function rangeLabel(offset: number, count: number, total: number): string {
  if (!total || !count) return `0 of ${formatInt(total)}`;
  return `${formatInt(offset + 1)}–${formatInt(offset + count)} of ${formatInt(total)}`;
}
