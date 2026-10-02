import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRemovedText, fetchShard } from "./fetcher";
import { ShardNotReadyError } from "./games-loader";
import { packBytes, sha256 } from "../../shared/data-pack";

/**
 * The app fetches PACKED shards when it can unpack them, and must hand the
 * loader exactly the committed bytes either way - games-loader.ts hashes them
 * against index.json. The plain path is a fallback for a pack that cannot be
 * had, never a second request after a network failure.
 */

const BODY = '{"link":"https://store.steampowered.com/app/730/","name":"Counter-Strike 2"}\n';
const enc = new TextEncoder();
let fetchMock: ReturnType<typeof vi.fn>;

async function packed(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const plain = enc.encode(text);
  return packBytes(plain, await sha256(plain));
}

function entry(sha256Hex = "a".repeat(64)) {
  return { name: "data_001.jsonl", count: 1, sha256: sha256Hex };
}

const text = (buf: ArrayBuffer) => new TextDecoder().decode(buf);
const urls = () => fetchMock.mock.calls.map(([u]) => String(u));

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchShard", () => {
  it("fetches the pack by hash and returns the unpacked bytes", async () => {
    fetchMock.mockResolvedValue(new Response(await packed(BODY)));
    const out = await fetchShard(entry(), true);
    expect(text(out)).toBe(BODY);
    expect(urls()).toEqual([`/api/data/p1/data_001.bin?v=${"a".repeat(64)}`]);
  });

  it("asks for the unversioned pack without the browser cache", async () => {
    fetchMock.mockResolvedValue(new Response(await packed(BODY)));
    await fetchShard(entry(), false);
    expect(urls()).toEqual(["/api/data/p1/data_001.bin"]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("reports a 503 as not-ready, exactly as the plain path does", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    await expect(fetchShard(entry(), true)).rejects.toBeInstanceOf(ShardNotReadyError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the plain path when there is no pack", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(BODY));
    const out = await fetchShard(entry(), true);
    expect(text(out)).toBe(BODY);
    expect(urls()[1]).toBe(`/api/data/data/data_001.jsonl?v=${"a".repeat(64)}`);
  });

  it("falls back when the answer is not a pack", async () => {
    fetchMock.mockResolvedValueOnce(new Response(BODY)).mockResolvedValueOnce(new Response(BODY));
    const out = await fetchShard(entry(), true);
    expect(text(out)).toBe(BODY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry the plain path after a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchShard(entry(), true)).rejects.toThrow("Failed to fetch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the plain path directly where packs cannot be opened", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    fetchMock.mockResolvedValue(new Response(BODY));
    const out = await fetchShard(entry(), true);
    expect(text(out)).toBe(BODY);
    expect(urls()).toEqual([`/api/data/data/data_001.jsonl?v=${"a".repeat(64)}`]);
  });
});

describe("fetchRemovedText", () => {
  const REMOVED = '{"link":"https://store.steampowered.com/app/1/","removed_at":"2026-01-01"}\n';

  it("reads the packed file", async () => {
    fetchMock.mockResolvedValue(new Response(await packed(REMOVED)));
    expect(await fetchRemovedText()).toBe(REMOVED);
    expect(urls()).toEqual(["/api/data/p1/removed_games.bin"]);
  });

  it("falls back to the plain file", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 404 }))
      .mockResolvedValueOnce(new Response(REMOVED));
    expect(await fetchRemovedText()).toBe(REMOVED);
    expect(urls()[1]).toBe("/api/data/scripts/removed_games.jsonl");
  });
});
