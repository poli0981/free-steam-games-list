/**
 * The games table's columns.
 *
 * Labels are i18n KEYS, not English strings. All twelve were hardcoded English
 * in the React version — inside an app whose every other visible string was
 * translated — so a Vietnamese reader got a Vietnamese page wrapped around an
 * English table header.
 *
 * `sortValue` exists because the numeric-looking fields are formatted strings.
 * `current_players` is `"492,197"` and `reviews` is `"86% (Very Positive)"`, so
 * sorting on the raw value puts "9" above "1,000,000" and orders reviews
 * alphabetically. Every sortable column parses first.
 */
import type { GameRecord } from "../schema";
import { parseIntSafe, parseReleaseDate, parseReviewPercent } from "../utils";

export type ColumnKey =
  | "thumb"
  | "issues"
  | "name"
  | "genre"
  | "type_game"
  | "reviews"
  | "current_players"
  | "anti_cheat"
  | "platforms"
  | "release_date"
  | "status"
  | "link";

export interface ColDef {
  key: ColumnKey;
  /** i18n key, or "" for the icon-only columns. */
  label: string;
  width: number;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  sortValue?: (g: GameRecord) => string | number;
}

export const COLS: ColDef[] = [
  { key: "thumb", label: "", width: 64 },
  { key: "issues", label: "", width: 30 },
  {
    key: "name",
    label: "games.colName",
    width: 300,
    sortable: true,
    sortValue: (g) => g.name?.toLowerCase() ?? "",
  },
  {
    key: "genre",
    label: "detail.labelGenre",
    width: 130,
    sortable: true,
    sortValue: (g) => g.genre ?? "",
  },
  {
    key: "type_game",
    label: "detail.labelType",
    width: 90,
    sortable: true,
    sortValue: (g) => g.type_game ?? "",
  },
  {
    key: "reviews",
    label: "detail.labelReviews",
    width: 100,
    sortable: true,
    align: "right",
    // -1 for unrated, so "N/A" clusters at one end instead of interleaving.
    sortValue: (g) => parseReviewPercent(g.reviews) ?? -1,
  },
  {
    key: "current_players",
    label: "detail.labelPlayers",
    width: 110,
    sortable: true,
    align: "right",
    sortValue: (g) => parseIntSafe(g.current_players),
  },
  {
    key: "anti_cheat",
    label: "detail.labelAntiCheat",
    width: 120,
    sortable: true,
    sortValue: (g) => g.anti_cheat ?? "",
  },
  { key: "platforms", label: "detail.labelPlatforms", width: 130 },
  {
    key: "release_date",
    label: "detail.labelReleased",
    width: 120,
    sortable: true,
    // Steam dates are "22 Aug, 2012" / "Dec 19, 2025" / "Coming Soon". A string
    // compare orders them alphabetically, which scrambles the years.
    sortValue: (g) => parseReleaseDate(g.release_date),
  },
  {
    key: "status",
    label: "detail.labelStatus",
    width: 100,
    sortable: true,
    sortValue: (g) => g.status ?? "",
  },
  { key: "link", label: "", width: 48 },
];

export const TOTAL_WIDTH = COLS.reduce((sum, c) => sum + c.width, 0);

/** Review percentage to a meaning-bearing token class. Not the accent colour:
 *  these three have to stay distinguishable from each other and from the
 *  brand. */
export function reviewTone(pct: number): string {
  if (pct >= 80) return "text-success";
  if (pct >= 70) return "text-warning";
  return "text-destructive";
}
