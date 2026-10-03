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
import { ShardNotReadyError, type FetchedShard } from "./games-loader";
import { packsSupported, unpackBytes } from "../../shared/data-pack";
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
 * One shard.
 *
 * `versioned` asks for it by the hash its index entry records. That response is
 * immutable, so it may come from any cache - no `no-store` - and the Worker
 * answers 503 rather than serve bytes that do not match, which surfaces here as
 * ShardNotReadyError. The unversioned form is the old path, kept for an index
 * without hashes and for a first visit during that 503 window.
 *
 * Both are fetched PACKED (/api/data/p1/*.bin, shared/data-pack.ts) when this
 * runtime can unpack, and returned unpacked as `plain`: the caller hashes and
 * parses the same bytes as ever. The pack itself comes back too, as `pack`,
 * because that is what the IndexedDB cache stores (lib/cache.ts). The plain
 * path - the fallback for a runtime without DecompressionStream or Web Crypto,
 * or a pack that will not open - has no pack to give.
 */
export async function fetchShard(
  entry: ShardManifestEntry,
  versioned: boolean,
  signal?: AbortSignal,
): Promise<FetchedShard> {
  if (packsSupported()) {
    try {
      return await fetchPacked(packUrl(entry.name), entry, versioned, signal);
    } catch (err) {
      if (!(err instanceof PackUnavailableError)) throw err;
      console.warn(`[fetchShard] ${entry.name}: ${err.message}; using the plain path`);
    }
  }
  const url = rawUrl(`${DATA_DIR}/${entry.name}`);
  const res = versioned && entry.sha256
    ? await fetch(`${url}?v=${entry.sha256}`, { signal })
    : await fetch(url, { signal, cache: "no-store" });
  if (versioned && res.status === 503) throw new ShardNotReadyError(entry.name);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${entry.name}: ${res.status}`);
  }
  return { plain: await res.arrayBuffer(), pack: null };
}

/** scripts/removed_games.jsonl as text, packed when possible (see fetchShard). */
export async function fetchRemovedText(signal?: AbortSignal): Promise<string> {
  if (packsSupported()) {
    try {
      const res = await fetch(packUrl("removed_games.jsonl"), { signal, cache: "no-store" });
      if (!res.ok) throw new PackUnavailableError(`HTTP ${res.status}`);
      return new TextDecoder().decode(await unpack(await res.arrayBuffer()));
    } catch (err) {
      if (!(err instanceof PackUnavailableError)) throw err;
      console.warn(`[fetchRemovedText] ${err.message}; using the plain path`);
    }
  }
  const res = await fetch(rawUrl("scripts/removed_games.jsonl"), { signal, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch removed_games.jsonl: ${res.status}`);
  }
  return await res.text();
}

/** The pack that stands for a repository file: `data_001.jsonl` -> `/api/data/p1/data_001.bin`. */
function packUrl(fileName: string): string {
  return `${DATA_BASE}/p1/${fileName.replace(/\.jsonl$/, ".bin")}`;
}

/** The packed path could not give us bytes; the plain path may still. */
class PackUnavailableError extends Error {}

async function fetchPacked(
  url: string,
  entry: ShardManifestEntry,
  versioned: boolean,
  signal?: AbortSignal,
): Promise<FetchedShard> {
  const res = versioned && entry.sha256
    ? await fetch(`${url}?v=${entry.sha256}`, { signal })
    : await fetch(url, { signal, cache: "no-store" });
  if (versioned && res.status === 503) throw new ShardNotReadyError(entry.name);
  if (!res.ok) throw new PackUnavailableError(`HTTP ${res.status}`);
  const pack = new Uint8Array(await res.arrayBuffer());
  return { plain: await unpack(pack), pack };
}

async function unpack(packed: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  try {
    const bytes = await unpackBytes(packed);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } catch (err) {
    throw new PackUnavailableError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Shard bytes → records. `packed`: the bytes are a pack, as the IndexedDB
 * cache holds them, and are opened first. Runs in the parser worker
 * (workers/jsonl-parser.ts) and in its main-thread fallback (worker-pool.ts).
 */
export async function decodeShard(bytes: ArrayBuffer | Uint8Array, packed: boolean): Promise<GameRecord[]> {
  return parseJsonl(new TextDecoder().decode(packed ? await unpackBytes(bytes) : bytes));
}

/** Parse JSONL text → records array. */
function parseJsonl(text: string): GameRecord[] {
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
