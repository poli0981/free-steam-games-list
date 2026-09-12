/**
 * Dataset fetchers. Returns parsed records.
 *
 * Data is served same-origin through the Worker at /api/data/*, which proxies
 * the files that remain canonical in Git. That keeps GitHub out of the request
 * path for visitors (so the privacy policy can say the page loads no
 * third-party resources) and puts caching under our control.
 *
 * The desktop/Android build is the exception: it loads from tauri://localhost,
 * where a relative URL would resolve against the app origin rather than the
 * site, so it needs the absolute origin.
 */
import {
  DATA_DIR,
  type DataIndex,
  type GameRecord,
} from "./schema";
import { migrateRecord } from "./data-store";
import { API_ORIGIN } from "./site";

/** Same-origin on the web; absolute inside the Tauri webview. */
const DATA_BASE = `${API_ORIGIN}/api/data`;

/**
 * `pathInRepo` is the path as it exists in the repository (e.g.
 * "data/index.json"); the Worker allowlists exactly the three paths the app
 * fetches, so this is not a general-purpose GitHub proxy.
 */
export function rawUrl(pathInRepo: string): string {
  return `${DATA_BASE}/${pathInRepo}`;
}

export async function fetchIndex(signal?: AbortSignal): Promise<DataIndex> {
  const res = await fetch(rawUrl(`${DATA_DIR}/index.json`), {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch index.json: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as DataIndex;
}

export async function fetchShardText(
  shardName: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(rawUrl(`${DATA_DIR}/${shardName}`), {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${shardName}: ${res.status}`);
  }
  return await res.text();
}

/** Parse JSONL text → records array (synchronous; called from worker). */
export function parseJsonl(text: string): GameRecord[] {
  const out: GameRecord[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      out.push(migrateRecord(obj));
    } catch (err) {
      console.warn(`[parseJsonl] line ${i + 1} skipped:`, err);
    }
  }
  return out;
}

export interface AllShardsResult {
  index: DataIndex;
  records: GameRecord[];
  shardOf: Map<string, string>; // appid → shard filename
}
