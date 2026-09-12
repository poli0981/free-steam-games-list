/**
 * Search, filter and sort for the games table.
 *
 * Kept as plain functions rather than a component or a rune so the page can
 * compose them in one `$derived` chain and so they are testable without a DOM.
 */
import Fuse from "fuse.js";
import type { GameRecord } from "../schema";
import { COLS } from "./columns";
import type { SortDir } from "../filters.svelte";

/**
 * Fuse options, carried over verbatim.
 *
 * `threshold: 0.32` is the tuned value — loose enough to survive a typo,
 * tight enough that a three-letter query does not return a third of the
 * catalogue. The key list matters as much: searching `description` is what
 * lets "battle royale" find games whose name says nothing of the sort.
 */
const FUSE_OPTIONS = {
  keys: ["name", "description", "tags", "developer", "publisher"],
  threshold: 0.32,
  ignoreLocation: true,
};

export interface FilterCriteria {
  search: string;
  genre: string | null;
  typeGame: "online" | "offline" | null;
  platform: string | null;
  safe: string | null;
  status: "active" | "delisted" | null;
  hasAntiCheat: boolean | null;
  hideDead: boolean;
}

/** Build the index once per record set, not once per keystroke: indexing 3,700
 *  records on every character typed is the difference between instant and
 *  visibly laggy. */
export function buildSearchIndex(records: GameRecord[]): Fuse<GameRecord> {
  return new Fuse(records, FUSE_OPTIONS);
}

export function applyFilters(
  records: GameRecord[],
  fuse: Fuse<GameRecord>,
  c: FilterCriteria,
): GameRecord[] {
  // Search first: it is the most selective, so every later predicate runs over
  // a smaller list.
  let out = c.search.trim() ? fuse.search(c.search.trim()).map((r) => r.item) : records;

  if (c.genre) out = out.filter((g) => g.genre === c.genre);
  if (c.typeGame) out = out.filter((g) => g.type_game === c.typeGame);
  if (c.platform) out = out.filter((g) => (g.platforms ?? []).includes(c.platform!));
  if (c.safe) out = out.filter((g) => g.safe === c.safe);
  if (c.status) out = out.filter((g) => g.status === c.status);
  if (c.hasAntiCheat !== null) {
    // "-" is the skeleton default for "none recorded", not a real anti-cheat.
    out = out.filter((g) => {
      const has = Boolean(g.anti_cheat && g.anti_cheat !== "-");
      return has === c.hasAntiCheat;
    });
  }
  if (c.hideDead) out = out.filter((g) => !g.is_dead);

  return out;
}

export function applySort(
  records: GameRecord[],
  sortKey: string | null,
  sortDir: SortDir,
): GameRecord[] {
  if (!sortKey || !sortDir) return records;
  const col = COLS.find((c) => c.key === sortKey);
  if (!col?.sortValue) return records;

  const get = col.sortValue;
  const factor = sortDir === "asc" ? 1 : -1;
  // Copy: sorting in place would mutate the memoised filtered array and make
  // the next derived run start from an already-sorted list.
  return [...records].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av === bv) return 0;
    return (av < bv ? -1 : 1) * factor;
  });
}

/** Facet counts for the dropdowns, so a reader can see that "MMORPG" has 41
 *  games before choosing it. Computed from the FULL record set, not the
 *  filtered one, or the options would vanish as soon as one was picked. */
export function facets(records: GameRecord[]) {
  const genre = new Map<string, number>();
  const platform = new Map<string, number>();
  for (const g of records) {
    if (g.genre) genre.set(g.genre, (genre.get(g.genre) ?? 0) + 1);
    for (const p of g.platforms ?? []) platform.set(p, (platform.get(p) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { genre: sorted(genre), platform: sorted(platform) };
}
