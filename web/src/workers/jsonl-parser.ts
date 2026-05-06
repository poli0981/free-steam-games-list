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

self.onmessage = (e: MessageEvent<InMessage>) => {
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
