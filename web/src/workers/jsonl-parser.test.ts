import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The parser worker's replies. Every failure must reach the page as a
 * NON-EMPTY `error`: a failed AES-GCM decrypt is a DOMException whose message
 * is empty in Chromium, and an empty error once let a damaged cached pack
 * through as a shard with no records.
 */

const decodeShard = vi.hoisted(() => vi.fn());
vi.mock("../lib/fetcher", () => ({ decodeShard }));

let replies: unknown[];
let fakeSelf: { onmessage: ((e: { data: unknown }) => Promise<void>) | null; postMessage: (m: unknown) => void };

beforeEach(async () => {
  replies = [];
  fakeSelf = { onmessage: null, postMessage: (m) => replies.push(m) };
  vi.stubGlobal("self", fakeSelf);
  vi.resetModules();
  await import("./jsonl-parser");
});

afterEach(() => {
  vi.unstubAllGlobals();
  decodeShard.mockReset();
});

describe("jsonl-parser worker", () => {
  it("replies with the records", async () => {
    decodeShard.mockResolvedValue([{ name: "Dota 2" }]);
    await fakeSelf.onmessage!({ data: { id: 7, bytes: new Uint8Array(4), packed: true } });
    expect(decodeShard).toHaveBeenCalledWith(new Uint8Array(4), true);
    expect(replies).toEqual([{ id: 7, records: [{ name: "Dota 2" }] }]);
  });

  it("names a failure even when its message is empty", async () => {
    decodeShard.mockRejectedValue(new DOMException("", "OperationError"));
    await fakeSelf.onmessage!({ data: { id: 8, bytes: new Uint8Array(4), packed: true } });
    expect(replies).toEqual([{ id: 8, error: "OperationError" }]);
  });

  it("refuses a malformed message instead of throwing", async () => {
    await fakeSelf.onmessage!({ data: { id: 9, text: "the old { id, text } shape" } });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ id: 9 });
    expect((replies[0] as { error: string }).error).toMatch(/malformed/);
    expect(decodeShard).not.toHaveBeenCalled();
  });
});
