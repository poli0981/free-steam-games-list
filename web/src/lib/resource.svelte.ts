/**
 * A minimal async resource, replacing TanStack Query.
 *
 * The React app pulled in @tanstack/react-query (~26 KB) for three queries:
 * the catalogue, the removed-games list, and the activity feed. What it
 * actually used from the library was `isLoading`, `error`, `data`, `refetch`,
 * a stale time, and one `refetchOnWindowFocus`. That is this file.
 *
 * Caching is NOT reimplemented here on purpose. The catalogue's real cache is
 * IndexedDB (lib/cache.ts), keyed on `index.json.last_updated`, which is the
 * only cache-invalidation signal this dataset has — a memory cache layered on
 * top would just be a second thing to get wrong.
 */

export interface ResourceOptions {
  /** How long a completed load stays fresh, in ms. A `load()` inside the
   *  window is a no-op unless `force` is passed. */
  staleTime?: number;
  /** Re-run when the tab regains focus and the data is stale. Off by default;
   *  the activity feed is the only caller that wants it. */
  refetchOnFocus?: boolean;
  /**
   * Whether a load may start yet. Checked by every load() - the focus refetch
   * and a Retry included - and read INSIDE it, so an $effect that calls load()
   * subscribes to whatever this reads and runs again when it turns true.
   * Every Resource in the app passes lib/app-ready.ts's appReady, which holds
   * it behind the consent gate and the human check.
   */
  enabled?: () => boolean;
}

export class Resource<T> {
  /**
   * $state.raw: loaded data is replaced whole, never mutated in place, and a
   * deep proxy over ~3,650 records is pure overhead. It also means assigning
   * the SAME object again is a no-op, which is what lets a revalidation that
   * found nothing new leave every page untouched.
   */
  data = $state.raw<T | undefined>(undefined);
  error = $state<Error | undefined>(undefined);
  loading = $state(false);

  #fetcher: (signal: AbortSignal) => Promise<T>;
  #staleTime: number;
  #enabled: () => boolean;
  #loadedAt = 0;
  #inFlight: Promise<void> | null = null;
  #controller: AbortController | null = null;

  constructor(fetcher: (signal: AbortSignal) => Promise<T>, opts: ResourceOptions = {}) {
    this.#fetcher = fetcher;
    this.#staleTime = opts.staleTime ?? 5 * 60 * 1000;
    this.#enabled = opts.enabled ?? (() => true);

    if (opts.refetchOnFocus && typeof window !== "undefined") {
      window.addEventListener("focus", () => void this.load());
    }
  }

  /**
   * Nothing to show yet: no data, and no error to explain why.
   *
   * Use this, not `loading && !data`, to decide between a loading state and
   * the page. `loading` is false BEFORE a load starts - during prerender, and
   * until consent is given - so the old check rendered the empty state instead:
   * the prerendered /games said "No game matches these filters." and /health
   * said "Nothing flagged".
   */
  get pending(): boolean {
    return this.data === undefined && this.error === undefined;
  }

  get stale(): boolean {
    return Date.now() - this.#loadedAt > this.#staleTime;
  }

  /**
   * Load, unless a load is already running or the data is still fresh.
   *
   * Returning the in-flight promise rather than starting a second request is
   * what lets several components call this on mount without stampeding: the
   * catalogue is ~6 MB across shards, so a duplicate load is not free.
   */
  load(force = false): Promise<void> {
    // First, before any early return: the $effect calling this has to read the
    // gate to be re-run when it opens.
    if (!this.#enabled()) return this.#inFlight ?? Promise.resolve();
    if (this.#inFlight) return this.#inFlight;
    if (!force && this.data !== undefined && !this.stale) return Promise.resolve();

    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;

    this.loading = true;
    this.error = undefined;

    this.#inFlight = this.#fetcher(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        this.data = value;
        this.#loadedAt = Date.now();
      })
      .catch((err: unknown) => {
        // An abort is a superseded request, not a failure. Reporting it would
        // paint an error banner describing a load the user already replaced.
        if (controller.signal.aborted) return;
        this.error = err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) this.loading = false;
        this.#inFlight = null;
      });

    return this.#inFlight;
  }

  /** Explicit user-driven retry: ignores the stale window. */
  refetch(): Promise<void> {
    return this.load(true);
  }

  /**
   * Check for newer data behind whatever is on screen.
   *
   * Unlike load(): `loading` stays false and a failure is NOT surfaced as
   * `error`, because the page is already showing correct data and replacing it
   * with an error banner over a transient blip would be worse than doing
   * nothing. The fetcher decides what "newer" means - for the catalogue that is
   * a ~600-byte index request that usually changes nothing.
   */
  revalidate(): Promise<void> {
    if (this.#inFlight || this.data === undefined) return this.#inFlight ?? Promise.resolve();

    const controller = new AbortController();
    this.#controller = controller;
    this.#inFlight = this.#fetcher(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        this.data = value;
        this.#loadedAt = Date.now();
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) console.warn("[resource] revalidate failed:", err);
      })
      .finally(() => {
        this.#inFlight = null;
      });
    return this.#inFlight;
  }
}
