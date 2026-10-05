import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePack, parseShard } from "./worker-pool";
import { packBytes, sha256 } from "../../shared/data-pack";

/**
 * Node has no Worker, so this drives the main-thread fallback - the same code
 * the worker runs (decodeShard), and what every shard still queued falls back
 * to if the worker dies.
 */

const BODY =
  '{"link":"https://store.steampowered.com/app/730/","name":"Counter-Strike 2"}\n' +
  '{"link":"https://store.steampowered.com/app/570/","name":"Dota 2"}\n';
const plain = new TextEncoder().encode(BODY);

describe("worker-pool", () => {
  it("parses a fetched shard's plain bytes", async () => {
    const records = await parseShard(plain.slice().buffer as ArrayBuffer);
    expect(records.map((r) => r.name)).toEqual(["Counter-Strike 2", "Dota 2"]);
  });

  it("opens and parses a cached pack", async () => {
    const pack = await packBytes(plain, await sha256(plain));
    const records = await parsePack(pack);
    expect(records.map((r) => r.name)).toEqual(["Counter-Strike 2", "Dota 2"]);
  });

  it("rejects a pack that will not open, so the cache counts as a miss", async () => {
    const pack = (await packBytes(plain, await sha256(plain))).slice();
    pack[20] ^= 0xff;
    await expect(parsePack(pack)).rejects.toThrow();
  });
});

describe("worker-pool with a worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A stand-in Worker that answers every message with `reply`. */
  async function poolAnswering(reply: (id: number) => object) {
    class FakeWorker {
      onmessage: ((e: { data: object }) => void) | null = null;
      onerror: ((e: { message: string }) => void) | null = null;
      postMessage(msg: { id: number }) {
        setTimeout(() => this.onmessage?.({ data: reply(msg.id) }));
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", FakeWorker);
    vi.resetModules(); // the pool keeps its worker in module state
    return import("./worker-pool");
  }

  it("rejects when the worker reports an error with an EMPTY message", async () => {
    // What Chromium's failed AES-GCM decrypt looks like after error.message.
    // Read as success, it resolved a damaged pack as a shard with no records.
    const pool = await poolAnswering((id) => ({ id, error: "" }));
    await expect(pool.parsePack(new Uint8Array(40))).rejects.toThrow();
  });

  it("resolves with the worker's records", async () => {
    const pool = await poolAnswering((id) => ({ id, records: [{ name: "Dota 2" }] }));
    expect(await pool.parseShard(plain.slice().buffer as ArrayBuffer)).toEqual([{ name: "Dota 2" }]);
  });
});
