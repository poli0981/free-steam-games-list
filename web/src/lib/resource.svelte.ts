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
}

export class Resource<T> {
  data = $state<T | undefined>(undefined);
  error = $state<Error | undefined>(undefined);
  loading = $state(false);

  #fetcher: (signal: AbortSignal) => Promise<T>;
  #staleTime: number;
  #loadedAt = 0;
  #inFlight: Promise<void> | null = null;
  #controller: AbortController | null = null;

  constructor(fetcher: (signal: AbortSignal) => Promise<T>, opts: ResourceOptions = {}) {
    this.#fetcher = fetcher;
    this.#staleTime = opts.staleTime ?? 5 * 60 * 1000;

    if (opts.refetchOnFocus && typeof window !== "undefined") {
      window.addEventListener("focus", () => void this.load());
    }
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
}
