/**
 * Table filter, sort and paging state for /games.
 *
 * Replaces the zustand store. Same fields and the same defaults — the page
 * size in particular: 100 was chosen because it fills the viewport without
 * making the virtualiser's overscan pointless, and -1 means "all", which the
 * virtualiser can handle precisely because it only renders what is visible.
 *
 * `selected` is deliberately NOT a $state Set mutated in place: Svelte 5 tracks
 * reassignment, and a mutated Set would update nothing.
 */
export type SortDir = "asc" | "desc" | null;
export type PageSize = 50 | 100 | 200 | 500 | -1;
export const PAGE_SIZES: PageSize[] = [50, 100, 200, 500, -1];

class Filters {
  search = $state("");
  genre = $state<string | null>(null);
  typeGame = $state<"online" | "offline" | null>(null);
  platform = $state<string | null>(null);
  safe = $state<string | null>(null);
  status = $state<"active" | "delisted" | null>(null);
  hasAntiCheat = $state<boolean | null>(null);
  hideDead = $state(false);
  sortKey = $state<string | null>(null);
  sortDir = $state<SortDir>(null);
  pageSize = $state<PageSize>(100);
  selected = $state<Set<string>>(new Set());

  /** True when anything other than the sort is narrowing the list. Drives the
   *  "clear filters" affordance, which must not appear for a sort alone. */
  get active(): boolean {
    return (
      this.search !== "" ||
      this.genre !== null ||
      this.typeGame !== null ||
      this.platform !== null ||
      this.safe !== null ||
      this.status !== null ||
      this.hasAntiCheat !== null ||
      this.hideDead
    );
  }

  toggleSelect(appid: string): void {
    const next = new Set(this.selected);
    if (next.has(appid)) next.delete(appid);
    else next.add(appid);
    this.selected = next;
  }

  selectAll(appids: string[]): void {
    this.selected = new Set(appids);
  }

  clearSelection(): void {
    this.selected = new Set();
  }

  /** Clears the filters but NOT the sort or page size: those are display
   *  preferences the reader set once, and resetting them alongside a filter
   *  clear is the kind of thing that makes people stop using a control. */
  reset(): void {
    this.search = "";
    this.genre = null;
    this.typeGame = null;
    this.platform = null;
    this.safe = null;
    this.status = null;
    this.hasAntiCheat = null;
    this.hideDead = false;
    this.selected = new Set();
  }
}

export const filters = new Filters();
