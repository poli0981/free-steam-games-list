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
 *
 * The page number lives here too, not in the page component: a component-local
 * page reset to 1 every time a reader opened a game and came Back.
 */
import type { SafeClass } from "./safety";

export type SortDir = "asc" | "desc" | null;
export type PageSize = 50 | 100 | 200 | 500 | -1;
export const PAGE_SIZES: PageSize[] = [50, 100, 200, 500, -1];

/** `safe` in the URL: "?" and "" are awkward there, so they get names. */
const SAFE_PARAM: Record<SafeClass, string> = { y: "y", n: "n", "?": "unreviewed", "": "unset" };

class Filters {
  search = $state("");
  genre = $state<string | null>(null);
  typeGame = $state<"online" | "offline" | null>(null);
  platform = $state<string | null>(null);
  safe = $state<SafeClass | null>(null);
  status = $state<"active" | "delisted" | null>(null);
  hasAntiCheat = $state<boolean | null>(null);
  hideDead = $state(false);
  sortKey = $state<string | null>(null);
  sortDir = $state<SortDir>(null);
  pageSize = $state<PageSize>(100);
  /** Zero-based. */
  page = $state(0);
  selected = $state<Set<string>>(new Set());

  /** The criteria `page` belongs to. A different set of results starts again
   *  at the first page; the same set (coming Back) keeps its place. */
  pageFor = "";

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

  /** Everything that decides WHICH rows are listed, and in what order. */
  get signature(): string {
    return JSON.stringify([
      this.search.trim(),
      this.genre,
      this.typeGame,
      this.platform,
      this.safe,
      this.status,
      this.hasAntiCheat,
      this.hideDead,
      this.sortKey,
      this.sortDir,
      this.pageSize,
    ]);
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
    this.page = 0;
    this.selected = new Set();
  }

  /** The state as a query string, defaults omitted. */
  toQuery(): URLSearchParams {
    const q = new URLSearchParams();
    if (this.search.trim()) q.set("q", this.search.trim());
    if (this.genre !== null) q.set("genre", this.genre);
    if (this.typeGame !== null) q.set("type", this.typeGame);
    if (this.platform !== null) q.set("platform", this.platform);
    if (this.safe !== null) q.set("safe", SAFE_PARAM[this.safe]);
    if (this.status !== null) q.set("status", this.status);
    if (this.hasAntiCheat !== null) q.set("ac", this.hasAntiCheat ? "yes" : "no");
    if (this.hideDead) q.set("dead", "hide");
    if (this.sortKey && this.sortDir) {
      q.set("sort", this.sortKey);
      q.set("dir", this.sortDir);
    }
    if (this.page > 0) q.set("page", String(this.page + 1));
    return q;
  }

  /**
   * Replace the filters with a query string's. Unknown values are ignored
   * rather than trusted: this is a link somebody may have typed. The sort key
   * is checked by the caller's column table (applySort ignores unknown keys).
   */
  fromQuery(q: URLSearchParams): void {
    this.reset();
    this.search = q.get("q") ?? "";
    this.genre = q.get("genre") || null;
    const type = q.get("type");
    this.typeGame = type === "online" || type === "offline" ? type : null;
    this.platform = q.get("platform") || null;
    const safe = Object.entries(SAFE_PARAM).find(([, param]) => param === q.get("safe"));
    this.safe = safe ? (safe[0] as SafeClass) : null;
    const status = q.get("status");
    this.status = status === "active" || status === "delisted" ? status : null;
    const ac = q.get("ac");
    this.hasAntiCheat = ac === "yes" ? true : ac === "no" ? false : null;
    this.hideDead = q.get("dead") === "hide";
    const dir = q.get("dir");
    if (q.get("sort") && (dir === "asc" || dir === "desc")) {
      this.sortKey = q.get("sort");
      this.sortDir = dir;
    }
    const page = Math.floor(Number(q.get("page")));
    this.page = Number.isFinite(page) && page > 1 ? page - 1 : 0;
    // The linked page belongs to the linked criteria.
    this.pageFor = this.signature;
  }
}

export const filters = new Filters();

/** Query parameters the /games page owns. */
export const FILTER_PARAMS = new Set(["q", "genre", "type", "platform", "safe", "status", "ac", "dead", "sort", "dir", "page"]);
