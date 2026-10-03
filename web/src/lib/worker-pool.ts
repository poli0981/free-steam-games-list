/**
 * Tiny single-worker shard parser proxy.
 *
 * One worker turns shard bytes into records off the main thread, one message
 * per shard: the plain JSONL bytes of a fresh download, or a pack straight
 * from the IndexedDB cache, which it opens first (decodeShard in fetcher.ts).
 * If the worker itself fails, every shard still waiting on it is parsed on the
 * main thread instead - see onerror.
 */
import type { GameRecord } from "./schema";
import { decodeShard } from "./fetcher";

interface Job {
  bytes: ArrayBuffer | Uint8Array;
  packed: boolean;
  resolve: (r: GameRecord[]) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Job>();

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(
      new URL("../workers/jsonl-parser.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (
      e: MessageEvent<{ id: number; records?: GameRecord[]; error?: string }>,
    ) => {
      const { id, records, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      // Not `if (error)`: a failed AES-GCM decrypt is a DOMException whose
      // message is EMPTY in Chromium, and "" read as success resolved a
      // damaged pack as a shard with no records - the cache then served the
      // catalogue a shard short instead of counting as a miss.
      if (typeof error === "string") p.reject(new Error(error || "the parser worker failed"));
      else p.resolve(records ?? []);
    };
    worker.onerror = (ev) => {
      console.warn("[worker] error, falling back to main-thread parse:", ev.message);
      worker?.terminate();
      worker = null;
      // The worker is gone, so no reply is coming for anything still queued.
      // Previously those promises were simply never settled, and the catalogue
      // load hung on "Loading…" forever.
      const orphans = [...pending.values()];
      pending.clear();
      for (const p of orphans) decodeShard(p.bytes, p.packed).then(p.resolve, p.reject);
    };
    return worker;
  } catch {
    return null;
  }
}

function parse(bytes: ArrayBuffer | Uint8Array, packed: boolean): Promise<GameRecord[]> {
  const w = getWorker();
  // Fallback: parse on the main thread.
  if (!w) return decodeShard(bytes, packed);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { bytes, packed, resolve, reject });
    // Copied, not transferred: a transferred buffer is emptied on this side,
    // and both onerror (which re-parses from it) and the loader (which hands
    // the packs to the cache after parsing) still need it.
    w.postMessage({ id, bytes, packed });
  });
}

/** A shard's plain JSONL bytes, as fetched. */
export function parseShard(bytes: ArrayBuffer): Promise<GameRecord[]> {
  return parse(bytes, false);
}

/** A shard's pack, as the IndexedDB cache holds it. Rejects if it will not open. */
export function parsePack(pack: Uint8Array): Promise<GameRecord[]> {
  return parse(pack, true);
}
