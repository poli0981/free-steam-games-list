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
  type ShardManifestEntry,
} from "./schema";
import { ShardNotReadyError } from "./games-loader";
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

/**
 * One shard's bytes.
 *
 * `versioned` asks for it by the hash its index entry records. That response is
 * immutable, so it may come from any cache - no `no-store` - and the Worker
 * answers 503 rather than serve bytes that do not match, which surfaces here as
 * ShardNotReadyError. The unversioned form is the old path, kept for an index
 * without hashes and for a first visit during that 503 window.
 */
export async function fetchShard(
  entry: ShardManifestEntry,
  versioned: boolean,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const url = rawUrl(`${DATA_DIR}/${entry.name}`);
  const res = versioned && entry.sha256
    ? await fetch(`${url}?v=${entry.sha256}`, { signal })
    : await fetch(url, { signal, cache: "no-store" });
  if (versioned && res.status === 503) throw new ShardNotReadyError(entry.name);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${entry.name}: ${res.status}`);
  }
  return await res.arrayBuffer();
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
