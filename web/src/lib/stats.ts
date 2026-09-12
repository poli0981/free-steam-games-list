/**
 * Aggregations over the catalogue.
 *
 * Lifted out of the React KpiCards component so the dashboard, /stats and the
 * chart pages all read the same numbers. They previously each recomputed their
 * own, which is how two pages come to disagree about how many games there are.
 *
 * Everything here parses before comparing. The numeric-looking fields are
 * formatted STRINGS — `current_players: "492,197"`, `reviews:
 * "86% (Very Positive)"`, `metacritic: "N/A"` — so a raw comparison silently
 * sorts "9" above "1,000,000".
 */
import type { GameRecord } from "./schema";
import { parseIntSafe, parseReviewPercent, parseReleaseDate } from "./utils";

export interface CatalogueKpis {
  total: number;
  online: number;
  offline: number;
  delisted: number;
  dead: number;
  totalPlayers: number;
  topPlayers: number;
  topPlayersGame: string;
  avgReview: number;
  ratedCount: number;
  topGenre: string;
  topGenreCount: number;
}

export function computeKpis(records: GameRecord[]): CatalogueKpis {
  let online = 0;
  let offline = 0;
  let delisted = 0;
  let dead = 0;
  let totalPlayers = 0;
  let topPlayers = 0;
  let topPlayersGame = "—";
  let reviewSum = 0;
  let ratedCount = 0;
  const genres = new Map<string, number>();

  for (const r of records) {
    if (r.type_game === "online") online++;
    else if (r.type_game === "offline") offline++;
    if (r.status === "delisted") delisted++;
    if (r.is_dead) dead++;

    const cp = parseIntSafe(r.current_players);
    totalPlayers += cp;
    if (cp > topPlayers) {
      topPlayers = cp;
      topPlayersGame = r.name;
    }

    const pct = parseReviewPercent(r.reviews);
    if (pct !== null) {
      reviewSum += pct;
      ratedCount++;
    }

    if (r.genre) genres.set(r.genre, (genres.get(r.genre) ?? 0) + 1);
  }

  let topGenre = "—";
  let topGenreCount = 0;
  for (const [g, n] of genres) {
    if (n > topGenreCount) {
      topGenreCount = n;
      topGenre = g;
    }
  }

  return {
    total: records.length,
    online,
    offline,
    delisted,
    dead,
    totalPlayers,
    topPlayers,
    topPlayersGame,
    avgReview: ratedCount ? Math.round(reviewSum / ratedCount) : 0,
    ratedCount,
    topGenre,
    topGenreCount,
  };
}

/** `value -> count`, sorted by count descending. The shape most charts want. */
export function countBy(
  records: GameRecord[],
  pick: (r: GameRecord) => string | string[] | null | undefined,
): { name: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const picked = pick(r);
    if (!picked) continue;
    for (const key of Array.isArray(picked) ? picked : [picked]) {
      const k = key?.trim();
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/** Top N by live player count, already parsed. */
export function topByPlayers(
  records: GameRecord[],
  n: number,
  filter?: (r: GameRecord) => boolean,
): { record: GameRecord; players: number }[] {
  const out: { record: GameRecord; players: number }[] = [];
  for (const r of records) {
    if (filter && !filter(r)) continue;
    const players = parseIntSafe(r.current_players);
    if (players > 0) out.push({ record: r, players });
  }
  out.sort((a, b) => b.players - a.players);
  return out.slice(0, n);
}

/** Release-year histogram, guarded to plausible years. A record with a garbled
 *  date would otherwise stretch the axis to the year 40000. */
export function releaseYears(records: GameRecord[]): { name: string; value: number }[] {
  const years = new Map<number, number>();
  for (const r of records) {
    // parseReleaseDate returns a TIMESTAMP, and -Infinity for the unparseable
    // values ("Coming Soon", "TBA", ""), which is why this guards on finiteness
    // rather than truthiness - 0 is a valid timestamp.
    const t = parseReleaseDate(r.release_date);
    if (!Number.isFinite(t)) continue;
    const y = new Date(t).getFullYear();
    if (y < 1990 || y > 2100) continue;
    years.set(y, (years.get(y) ?? 0) + 1);
  }
  return [...years.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, value]) => ({ name: String(y), value }));
}
