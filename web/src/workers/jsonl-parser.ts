/// <reference lib="webworker" />
/**
 * Web Worker: parse JSONL text off the main thread.
 * Receives { id, text }, returns { id, records } or { id, error }.
 */
import { parseJsonl } from "../lib/fetcher";

interface InMessage {
  id: number;
  text: string;
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
  return (
    typeof d === "object" &&
    d !== null &&
    typeof (d as InMessage).id === "number" &&
    typeof (d as InMessage).text === "string"
  );
}

self.onmessage = (e: MessageEvent<unknown>) => {
  if (!isInMessage(e.data)) {
    const id = (e.data as { id?: unknown } | null)?.id;
    (self as unknown as Worker).postMessage({
      id: typeof id === "number" ? id : -1,
      error: "jsonl-parser: malformed message (expected { id: number, text: string })",
    });
    return;
  }
  const { id, text } = e.data;
  try {
    const records = parseJsonl(text);
    (self as unknown as Worker).postMessage({ id, records });
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
