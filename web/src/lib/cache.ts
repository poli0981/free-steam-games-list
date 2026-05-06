/**
 * IndexedDB cache via idb-keyval. Keyed on data_index.last_updated.
 */
import { get, set, del } from "idb-keyval";
import type { DataIndex, GameRecord } from "./schema";

const KEY_RECORDS = "f2p:records";
const KEY_INDEX = "f2p:index";

export interface CachedBundle {
  index: DataIndex;
  records: GameRecord[];
}

export async function readCache(): Promise<CachedBundle | null> {
  try {
    const [records, index] = await Promise.all([
      get<GameRecord[]>(KEY_RECORDS),
      get<DataIndex>(KEY_INDEX),
    ]);
    if (records && index) return { records, index };
  } catch {
    /* ignore */
  }
  return null;
}

export async function writeCache(bundle: CachedBundle): Promise<void> {
  try {
    await Promise.all([
      set(KEY_RECORDS, bundle.records),
      set(KEY_INDEX, bundle.index),
    ]);
  } catch (err) {
    console.warn("[cache] write failed:", err);
  }
}

export async function clearCache(): Promise<void> {
  await Promise.all([del(KEY_RECORDS), del(KEY_INDEX)]);
}

export function isCacheFresh(cached: DataIndex, fresh: DataIndex): boolean {
  return cached.last_updated === fresh.last_updated;
}
