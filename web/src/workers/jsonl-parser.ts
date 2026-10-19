/// <reference lib="webworker" />
/**
 * Web Worker: turn shard bytes into records off the main thread.
 * Receives { id, bytes, packed }, returns { id, records } or { id, error }.
 * `packed` bytes are a pack from the IndexedDB cache and are opened first.
 */
import { decodeShard } from "../lib/fetcher";

interface InMessage {
  id: number;
  bytes: ArrayBuffer | Uint8Array;
  packed: boolean;
}

/**
 * The only sender is the document that constructed this DEDICATED module
 * worker (lib/worker-pool.ts, `new Worker(new URL(...), { type: "module" })`).
 * Its messages arrive on the worker's implicit port, so their origin is "".
 * The handler refuses any other origin (CodeQL js/missing-origin-check) and
 * checks the shape, so a stray or malformed post fails as a rejected promise
 * instead of an unhandled throw inside the worker.
 */
function isInMessage(d: unknown): d is InMessage {
  if (typeof d !== "object" || d === null) return false;
  const m = d as InMessage;
  return (
    typeof m.id === "number" &&
    (m.bytes instanceof ArrayBuffer || m.bytes instanceof Uint8Array) &&
    typeof m.packed === "boolean"
  );
}

self.onmessage = async (e: MessageEvent<unknown>) => {
  const sentId = (e.data as { id?: unknown } | null)?.id;
  const replyId = typeof sentId === "number" ? sentId : -1;
  // `e.origin &&` is load-bearing: the owner's messages carry "", which never
  // equals self.location.origin, so without it every message would be refused.
  if (e.origin && e.origin !== self.location.origin) {
    (self as unknown as Worker).postMessage({
      id: replyId,
      error: `jsonl-parser: message from another origin (${e.origin})`,
    });
    return;
  }
  if (!isInMessage(e.data)) {
    (self as unknown as Worker).postMessage({
      id: replyId,
      error: "jsonl-parser: malformed message (expected { id: number, bytes: ArrayBuffer | Uint8Array, packed: boolean })",
    });
    return;
  }
  const { id, bytes, packed } = e.data;
  try {
    const records = await decodeShard(bytes, packed);
    (self as unknown as Worker).postMessage({ id, records });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: describe(error) });
  }
};

/** Never empty: a failed decrypt is a DOMException with an empty message in Chromium. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "Error";
  return String(error) || "unknown error";
}

export {};
