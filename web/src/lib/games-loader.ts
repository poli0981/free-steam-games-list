/**
 * How the catalogue is loaded, as a pure function of its I/O.
 *
 * Kept free of Svelte and of real fetch/IndexedDB so games-loader.test.ts can
 * drive every branch. games.svelte.ts supplies the real dependencies.
 *
 * THE CONTRACT (see _save_index() in scripts/core/data_store.py)
 * data/index.json names a generation: `last_updated` plus, for every shard,
 * its name, count and the sha256 of its exact bytes. A generation is only ever
 * CACHED once every one of its shards has been received and verified against
 * those hashes.
 *
 * That rule is the fix for a stale-data bug that no amount of TTL tuning
 * could close: index.json and the shards are cached independently on the way
 * here (this Worker's edge, raw.githubusercontent's CDN, and once a service
 * worker), so right after a data commit a client could receive the NEW index
 * with an OLD shard - and the previous loader wrote that pair to IndexedDB under
 * the new `last_updated`, where it stayed until the next data change.
 */
import type { DataIndex, GameRecord, ShardManifestEntry } from "./schema";

export interface Generation {
  index: DataIndex;
  records: GameRecord[];
}

export interface LoaderDeps {
  fetchIndex(signal: AbortSignal): Promise<DataIndex>;
  /** Shard bytes. `versioned` asks for them by hash (`?v=<sha256>`). */
  fetchShard(entry: ShardManifestEntry, versioned: boolean, signal: AbortSignal): Promise<ArrayBuffer>;
  /** Lowercase hex sha256, or null where Web Crypto is unavailable. */
  hash(bytes: ArrayBuffer): Promise<string | null>;
  parse(bytes: ArrayBuffer): Promise<GameRecord[]>;
  readCache(): Promise<Generation | null>;
  writeCache(generation: Generation): Promise<void>;
}

export interface LoadResult extends Generation {
  /** The index could not be fetched; this is the last generation held. */
  offline: boolean;
  /** Shown without verification (and therefore not cached). */
  unverified: boolean;
  /** A newer generation exists but is not available yet: try again then. */
  retryInMs: number | null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The same data: stamp, shard list, and (when both carry them) hashes. */
export function sameGeneration(a: DataIndex, b: DataIndex): boolean {
  if (a.last_updated !== b.last_updated || a.files.length !== b.files.length) return false;
  return a.files.every((f, i) => {
    const g = b.files[i];
    if (f.name !== g.name || f.count !== g.count) return false;
    return !f.sha256 || !g.sha256 || f.sha256 === g.sha256;
  });
}

/** Every entry carries a well-formed hash, so shards can be fetched by it. */
export function isVersioned(index: DataIndex): boolean {
  return index.files.length > 0 && index.files.every((f) => SHA256_HEX.test(f.sha256 ?? ""));
}

/** A shard that exists but is not yet the bytes the index describes (a 503). */
export class ShardNotReadyError extends Error {
  constructor(name: string) {
    super(`${name} is not updated upstream yet`);
    this.name = "ShardNotReadyError";
  }
}

/** First retry after a minute, then doubling, capped at ten. */
export function retryDelay(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt), 600_000);
}

export function createLoader(deps: LoaderDeps) {
  return async function load(
    signal: AbortSignal,
    current?: Generation,
    attempt = 0,
  ): Promise<LoadResult> {
    const ok = (g: Generation): LoadResult => ({ ...g, offline: false, unverified: false, retryInMs: null });

    let index: DataIndex;
    try {
      index = await deps.fetchIndex(signal);
    } catch (err) {
      if (signal.aborted) throw err;
      // Offline, or the Worker is unreachable. Whatever generation is held is
      // still correct data - it just may not be the newest - so show it.
      const held = current ?? (await deps.readCache());
      if (held) return { ...held, offline: true, unverified: false, retryInMs: null };
      throw err;
    }

    // Nothing changed: no shard is fetched at all.
    if (current && sameGeneration(current.index, index)) return ok(current);
    const cached = await deps.readCache();
    if (cached && sameGeneration(cached.index, index)) return ok(cached);

    if (!isVersioned(index)) {
      // An index written before hashes existed. Behave as the old loader did.
      const bytes = await Promise.all(index.files.map((f) => deps.fetchShard(f, false, signal)));
      const fresh = { index, records: (await Promise.all(bytes.map((b) => deps.parse(b)))).flat() };
      void deps.writeCache(fresh).catch(() => {});
      return ok(fresh);
    }

    let verified: ArrayBuffer[] | null = null;
    try {
      const bytes = await Promise.all(index.files.map((f) => deps.fetchShard(f, true, signal)));
      const hashes = await Promise.all(bytes.map((b) => deps.hash(b)));
      // null = no Web Crypto here. The Worker only ever answers `?v=` with
      // bytes that hash to v, so that path is still verified, once.
      if (hashes.every((h, i) => h === null || h === index.files[i].sha256)) verified = bytes;
    } catch (err) {
      if (signal.aborted) throw err;
      if (!(err instanceof ShardNotReadyError)) throw err;
    }

    if (verified) {
      const fresh = { index, records: (await Promise.all(verified.map((b) => deps.parse(b)))).flat() };
      void deps.writeCache(fresh).catch(() => {});
      return ok(fresh);
    }

    // The upstream has not caught up with this commit yet.
    const retryInMs = retryDelay(attempt);
    const held = current ?? cached;
    if (held) return { ...held, offline: false, unverified: false, retryInMs };

    // Nothing held at all (a first visit in that window). Show the unversioned
    // shards so the page is not empty, but never cache them.
    const bytes = await Promise.all(index.files.map((f) => deps.fetchShard(f, false, signal)));
    const records = (await Promise.all(bytes.map((b) => deps.parse(b)))).flat();
    return { index, records, offline: false, unverified: true, retryInMs };
  };
}
