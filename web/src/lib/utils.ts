import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "" || n === "N/A") return "—";
  const num = typeof n === "string" ? parseInt(n.replace(/,/g, ""), 10) : n;
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString("en-US");
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

export function formatRelativeDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
