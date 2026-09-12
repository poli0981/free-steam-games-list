/**
 * The catalogue, loaded once and shared by every page.
 *
 * Replaces the `useGames` / `useRemovedGames` hooks. The loading strategy is
 * carried over unchanged, because each step of it is load-bearing:
 *
 *   1. Read the IndexedDB cache and fetch `data/index.json`.
 *   2. If the cached `last_updated` matches, use the cached records and fetch
 *      nothing else. That field is the ONLY cache-invalidation signal this
 *      dataset has — anything that writes a shard must also bump it.
 *   3. Otherwise fetch every shard and parse the JSONL off the main thread in
 *      a worker, because parsing ~3,700 records blocks it for long enough to
 *      drop frames.
 */
import { fetchIndex, fetchShardText, rawUrl } from "./fetcher";
import { parseShard } from "./worker-pool";
import { readCache, writeCache, isCacheFresh, type CachedBundle } from "./cache";
import { buildIndex, extractAppid } from "./data-store";
import { Resource } from "./resource.svelte";
import type { GameRecord, DataIndex } from "./schema";

export interface GamesData {
  index: DataIndex;
  records: GameRecord[];
  /** appid → position in `records`. Built once; every lookup by appid uses it
   *  rather than scanning 3,700 rows. */
  appidIndex: Map<string, number>;
}

async function loadAll(signal: AbortSignal): Promise<GamesData> {
  const cached = await readCache();
  const index = await fetchIndex(signal);

  if (cached && isCacheFresh(cached.index, index)) {
    return {
      index: cached.index,
      records: cached.records,
      appidIndex: buildIndex(cached.records),
    };
  }

  const shardTexts = await Promise.all(
    index.files.map((f) => fetchShardText(f.name, signal)),
  );
  const parsed = await Promise.all(shardTexts.map((t) => parseShard(t)));
  const records = parsed.flat();

  const bundle: CachedBundle = { index, records };
  // Not awaited: a failed cache write must not fail the load. The next visit
  // simply refetches.
  void writeCache(bundle);

  return { index, records, appidIndex: buildIndex(records) };
}

export const games = new Resource<GamesData>(loadAll, { staleTime: 5 * 60 * 1000 });

/* ─────────────────────────── removed games ─────────────────────────── */

export interface RemovedGame {
  link: string;
  name: string;
  appid?: string;
  reason: string;
  status_code: "not_free" | "unavailable" | string;
  removed_at: string;
  [extra: string]: unknown;
}

/**
 * Mirrors `dedup_removed` in scripts/core/data_store.py: when an appid appears
 * more than once, keep the row with the most recent `removed_at`. Historic
 * delete flows wrote full game metadata onto these rows, hence the index
 * signature.
 */
function dedup(records: RemovedGame[]): RemovedGame[] {
  const latest = new Map<string, RemovedGame>();
  for (const r of records) {
    const aid = r.appid || extractAppid(r.link);
    if (!aid) continue;
    const prev = latest.get(aid);
    if (!prev || (r.removed_at ?? "") > (prev.removed_at ?? "")) {
      latest.set(aid, r);
    }
  }
  return [...latest.values()];
}

async function loadRemoved(signal: AbortSignal): Promise<RemovedGame[]> {
  const res = await fetch(rawUrl("scripts/removed_games.jsonl"), {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch removed_games.jsonl: ${res.status}`);
  }
  const out: RemovedGame[] = [];
  for (const line of (await res.text()).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RemovedGame);
    } catch {
      // One malformed line must not lose the rest of the file.
    }
  }
  return dedup(out);
}

export const removedGames = new Resource<RemovedGame[]>(loadRemoved, {
  staleTime: 5 * 60 * 1000,
});
