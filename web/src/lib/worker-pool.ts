/**
 * Tiny single-worker JSONL parser proxy.
 *
 * One worker parses the shards (five of them at ~800 records each) off the main
 * thread, one message per shard. If the worker itself fails, every shard still
 * waiting on it is parsed on the main thread instead - see onerror.
 */
import type { GameRecord } from "./schema";
import { parseJsonl } from "./fetcher";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { text: string; resolve: (r: GameRecord[]) => void; reject: (e: Error) => void }
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
      // The worker is gone, so no reply is coming for anything still queued.
      // Previously those promises were simply never settled, and the catalogue
      // load hung on "Loading…" forever.
      const orphans = [...pending.values()];
      pending.clear();
      for (const p of orphans) {
        try {
          p.resolve(parseJsonl(p.text));
        } catch (err) {
          p.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
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
    pending.set(id, { text, resolve, reject });
    w.postMessage({ id, text });
  });
}
