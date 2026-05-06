/**
 * Tiny single-worker JSONL parser proxy.
 * For 2 shards, a 1-worker pool is enough; expand to N if more shards added.
 */
import type { GameRecord } from "./schema";
import { parseJsonl } from "./fetcher";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (r: GameRecord[]) => void; reject: (e: Error) => void }
>();

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
      if (error) p.reject(new Error(error));
      else p.resolve(records ?? []);
    };
    worker.onerror = (ev) => {
      console.warn("[worker] error, falling back to main-thread parse:", ev.message);
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export function parseShard(text: string): Promise<GameRecord[]> {
  const w = getWorker();
  if (!w) {
    // Fallback: parse on main thread.
    return Promise.resolve(parseJsonl(text));
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, text });
  });
}
