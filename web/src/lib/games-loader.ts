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
 *
 * WHAT IS CACHED is each shard's pack as it arrived (shared/data-pack.ts),
 * never parsed records: see lib/cache.ts. So a cached generation is decoded
 * only when it is actually used, never just to compare its index.
 */
import type { DataIndex, GameRecord, ShardManifestEntry } from "./schema";

export interface Generation {
  index: DataIndex;
  records: GameRecord[];
}

/** One shard as fetched. */
export interface FetchedShard {
  /** The committed bytes: what is hashed and parsed. */
  plain: ArrayBuffer;
  /** The pack they arrived in, or null when they came over the plain path. */
  pack: Uint8Array | null;
}

/** A cached generation whose records are decoded only when asked for. */
export interface CachedGeneration {
  index: DataIndex;
  /** null: the cache would not decode, which makes it a miss. */
  records(): Promise<GameRecord[] | null>;
}

export interface LoaderDeps {
  fetchIndex(signal: AbortSignal): Promise<DataIndex>;
  /** One shard. `versioned` asks for it by hash (`?v=<sha256>`). */
  fetchShard(entry: ShardManifestEntry, versioned: boolean, signal: AbortSignal): Promise<FetchedShard>;
  /** Lowercase hex sha256, or null where Web Crypto is unavailable. */
  hash(bytes: ArrayBuffer): Promise<string | null>;
  parse(bytes: ArrayBuffer): Promise<GameRecord[]>;
  readCache(): Promise<CachedGeneration | null>;
  /**
   * Offered every generation this loader would cache, with each shard's pack
   * (null where it came over the plain path). The cache decides what it can
   * store.
   */
  writeCache(index: DataIndex, packs: (Uint8Array | null)[]): Promise<void>;
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
  /** A cached generation's records, or null when there is none or it will not decode. */
  async function decode(cached: CachedGeneration | null): Promise<Generation | null> {
    const records = cached ? await cached.records() : null;
    return cached && records ? { index: cached.index, records } : null;
  }

  async function parseAll(shards: FetchedShard[]): Promise<GameRecord[]> {
    return (await Promise.all(shards.map((s) => deps.parse(s.plain)))).flat();
  }

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
      const held = current ?? (await decode(await deps.readCache()));
      if (held) return { ...held, offline: true, unverified: false, retryInMs: null };
      throw err;
    }

    // Nothing changed: no shard is fetched at all.
    if (current && sameGeneration(current.index, index)) return ok(current);
    const cached = await deps.readCache();
    if (cached && sameGeneration(cached.index, index)) {
      const hit = await decode(cached);
      if (hit) return ok(hit);
    }

    if (!isVersioned(index)) {
      // An index written before hashes existed. Behave as the old loader did.
      const shards = await Promise.all(index.files.map((f) => deps.fetchShard(f, false, signal)));
      const fresh = { index, records: await parseAll(shards) };
      void deps.writeCache(index, shards.map((s) => s.pack)).catch(() => {});
      return ok(fresh);
    }

    let verified: FetchedShard[] | null = null;
    try {
      const shards = await Promise.all(index.files.map((f) => deps.fetchShard(f, true, signal)));
      const hashes = await Promise.all(shards.map((s) => deps.hash(s.plain)));
      // null = no Web Crypto here. The Worker only ever answers `?v=` with
      // bytes that hash to v, so that path is still verified, once.
      if (hashes.every((h, i) => h === null || h === index.files[i].sha256)) verified = shards;
    } catch (err) {
      if (signal.aborted) throw err;
      if (!(err instanceof ShardNotReadyError)) throw err;
    }

    if (verified) {
      const fresh = { index, records: await parseAll(verified) };
      void deps.writeCache(index, verified.map((s) => s.pack)).catch(() => {});
      return ok(fresh);
    }

    // The upstream has not caught up with this commit yet.
    const retryInMs = retryDelay(attempt);
    const held = current ?? (await decode(cached));
    if (held) return { ...held, offline: false, unverified: false, retryInMs };

    // Nothing held at all (a first visit in that window). Show the unversioned
    // shards so the page is not empty, but never cache them.
    const shards = await Promise.all(index.files.map((f) => deps.fetchShard(f, false, signal)));
    return { index, records: await parseAll(shards), offline: false, unverified: true, retryInMs };
  };
}
