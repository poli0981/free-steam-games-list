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
 * CodeQL flags this as `js/missing-origin-check`. An `e.origin` check is not
 * the right fix here: this is a DEDICATED module worker (see lib/worker-pool.ts,
 * `new Worker(new URL(...), { type: "module" })`), so the only sender is the
 * document that constructed it — there is no cross-origin sender to filter, and
 * `MessageEvent.origin` is the empty string for dedicated workers. The real
 * hardening is validating the message shape, so a malformed post fails as a
 * rejected promise instead of an unhandled throw inside the worker.
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
  if (!isInMessage(e.data)) {
    const id = (e.data as { id?: unknown } | null)?.id;
    (self as unknown as Worker).postMessage({
      id: typeof id === "number" ? id : -1,
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
