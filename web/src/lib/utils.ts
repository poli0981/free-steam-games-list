import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The active locale, read from the <html lang> attribute that lib/i18n keeps in
 * sync.
 *
 * Read from the DOM rather than imported from the i18n store on purpose: these
 * helpers are called from non-reactive places (chart formatters, table cell
 * renderers, the export builder) and importing a rune store into them would
 * make a plain utility module reactive and circular.
 */
function activeLocale(): string {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang || "en";
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "" || n === "N/A") return "—";
  const num = typeof n === "string" ? parseInt(n.replace(/,/g, ""), 10) : n;
  if (Number.isNaN(num)) return String(n);
  // Was hardcoded "en-US", so a Vietnamese reader saw "1,234,567" where their
  // locale groups as "1.234.567".
  return num.toLocaleString(activeLocale());
}

export function parseIntSafe(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return 0;
  const cleaned = val.replace(/,/g, "").trim();
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? 0 : n;
}

export function parseReviewPercent(reviews: string | undefined | null): number | null {
  if (!reviews || reviews === "N/A") return null;
  const m = reviews.match(/(\d+)\s*%/);
  return m ? parseInt(m[1], 10) : null;
}

export function reviewLabel(reviews: string | undefined | null): string | null {
  if (!reviews || reviews === "N/A") return null;
  const m = reviews.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : null;
}

/**
 * Convert a Steam-style release_date ("22 Aug, 2012", "Dec 19, 2025",
 * "Coming Soon", "TBA", "" ...) to a comparable timestamp for sorting.
 * Unparseable / future-unknown values get -Infinity so they cluster at the
 * "asc" end (oldest first) and the "desc" end (newest first) regardless of
 * direction — sliding them out of the way of the real data.
 */
export function parseReleaseDate(s: string | undefined | null): number {
  if (!s) return -Infinity;
  const trimmed = s.trim();
  if (!trimmed) return -Infinity;
  // Year-only ("2025") is also valid; Date.parse handles "1 Jan, 2025" etc.
  const t = Date.parse(trimmed);
  if (Number.isFinite(t)) return t;
  // "2025" alone: try as year start.
  const yearOnly = /^\d{4}$/.exec(trimmed);
  if (yearOnly) return Date.UTC(parseInt(yearOnly[0], 10), 0, 1);
  return -Infinity;
}

/**
 * "3 days ago", in the reader's language.
 *
 * Previously returned hardcoded English - "today", "3d ago", "2w ago" - inside
 * an otherwise fully translated app, so a Vietnamese reader got Vietnamese
 * chrome around English timestamps. Intl.RelativeTimeFormat does the wording
 * and the pluralisation, which is exactly the part that cannot be done with a
 * template string per language.
 */
export function formatRelativeDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const seconds = Math.round((d.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(activeLocale(), { numeric: "auto" });

  // Largest unit that still has a whole number, so "45 days ago" reads as
  // "last month" rather than a count nobody converts in their head.
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, secondsPer] of units) {
    if (Math.abs(seconds) >= secondsPer) {
      return rtf.format(Math.round(seconds / secondsPer), unit);
    }
  }
  // numeric:"auto" turns this into "now" rather than "in 0 seconds".
  return rtf.format(0, "second");
}
