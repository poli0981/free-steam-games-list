/**
 * useGames — TanStack Query hook fetching all shards, parsing in worker, caching to IndexedDB.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchIndex, fetchShardText } from "../lib/fetcher";
import { parseShard } from "../lib/worker-pool";
import { readCache, writeCache, isCacheFresh, type CachedBundle } from "../lib/cache";
import { buildIndex } from "../lib/data-store";
import type { GameRecord, DataIndex } from "../lib/schema";

export interface GamesData {
  index: DataIndex;
  records: GameRecord[];
  appidIndex: Map<string, number>;
}

async function loadAll(signal?: AbortSignal): Promise<GamesData> {
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
  void writeCache(bundle);

  return { index, records, appidIndex: buildIndex(records) };
}

export function useGames() {
  return useQuery<GamesData, Error>({
    queryKey: ["games", "all"],
    queryFn: ({ signal }) => loadAll(signal),
    staleTime: 5 * 60 * 1000,
  });
}
