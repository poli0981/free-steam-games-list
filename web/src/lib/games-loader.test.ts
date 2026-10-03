import { describe, expect, it, vi } from "vitest";
import {
  createLoader,
  isVersioned,
  retryDelay,
  sameGeneration,
  ShardNotReadyError,
  type Generation,
  type LoaderDeps,
} from "./games-loader";
import type { DataIndex, GameRecord, ShardManifestEntry } from "./schema";

/**
 * The rule under test: a generation is cached only when every shard matched the
 * sha256 its index entry records. The bug it replaces stored a NEW index next to
 * an OLD shard, and that pair survived until the next data change.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

async function sha(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function shardText(names: string[]): string {
  return names.map((n) => JSON.stringify({ link: `https://store.steampowered.com/app/${n}/`, name: n })).join("\n") + "\n";
}

async function index(stamp: string, shards: string[][], hashed = true): Promise<{ index: DataIndex; bodies: Map<string, string> }> {
  const bodies = new Map<string, string>();
  const files: ShardManifestEntry[] = [];
  for (const [i, names] of shards.entries()) {
    const name = `data_00${i + 1}.jsonl`;
    const text = shardText(names);
    bodies.set(name, text);
    files.push({ name, count: names.length, ...(hashed ? { sha256: await sha(text) } : {}) });
  }
  return { index: { max_per_file: 800, total: shards.flat().length, last_updated: stamp, files }, bodies };
}

/** What the harness's IndexedDB holds: a generation, and whether it will open. */
type Cached = Generation & { corrupt?: boolean };

interface Harness {
  deps: LoaderDeps;
  fetchShard: ReturnType<typeof vi.fn>;
  writeCache: ReturnType<typeof vi.fn>;
  /** Calls to the cached generation's records(): each one is a decode. */
  decode: ReturnType<typeof vi.fn>;
}

/** A stand-in pack: the loader never opens one, it only hands it to the cache. */
const packOf = (name: string) => enc.encode(`pack:${name}`);

function harness(opts: {
  index: DataIndex | Error;
  /** What the network returns for each shard name, versioned or not. */
  bodies: Map<string, string>;
  /** Shards that 503 when requested by hash. */
  notReady?: Set<string>;
  /** Shards that arrive over the plain path, so without a pack. */
  plainPath?: Set<string>;
  cached?: Cached | null;
  noCrypto?: boolean;
}): Harness {
  const fetchShard = vi.fn(async (entry: ShardManifestEntry, versioned: boolean) => {
    if (versioned && opts.notReady?.has(entry.name)) throw new ShardNotReadyError(entry.name);
    return {
      plain: enc.encode(opts.bodies.get(entry.name) ?? "").buffer as ArrayBuffer,
      pack: opts.plainPath?.has(entry.name) ? null : packOf(entry.name),
    };
  });
  const writeCache = vi.fn(async (_index: DataIndex, _packs: (Uint8Array | null)[]) => {});
  const decode = vi.fn(async (c: Cached) => (c.corrupt ? null : c.records));
  const cached = opts.cached ?? null;
  const deps: LoaderDeps = {
    fetchIndex: async () => {
      if (opts.index instanceof Error) throw opts.index;
      return opts.index;
    },
    fetchShard,
    hash: async (bytes) => {
      if (opts.noCrypto) return null;
      const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
    parse: async (bytes) =>
      dec
        .decode(bytes)
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as GameRecord),
    readCache: async () => cached && { index: cached.index, records: () => decode(cached) },
    writeCache,
  };
  return { deps, fetchShard, writeCache, decode };
}

const signal = () => new AbortController().signal;

describe("sameGeneration / isVersioned", () => {
  it("compares stamp, shard list and hashes", async () => {
    const a = (await index("t1", [["1"], ["2"]])).index;
    const b = (await index("t1", [["1"], ["2"]])).index;
    expect(sameGeneration(a, b)).toBe(true);
    const c = (await index("t1", [["1"], ["3"]])).index;
    expect(sameGeneration(a, c)).toBe(false);
    expect(sameGeneration(a, { ...a, last_updated: "t2" })).toBe(false);
  });

  it("a legacy index is not versioned", async () => {
    expect(isVersioned((await index("t", [["1"]], false)).index)).toBe(false);
    expect(isVersioned((await index("t", [["1"]])).index)).toBe(true);
  });

  it("backs off from a minute to ten", () => {
    expect(retryDelay(0)).toBe(60_000);
    expect(retryDelay(1)).toBe(120_000);
    expect(retryDelay(9)).toBe(600_000);
  });
});

describe("createLoader", () => {
  it("verifies, parses and caches a new generation - as the packs it arrived in", async () => {
    const { index: idx, bodies } = await index("t1", [["1", "2"], ["3"]]);
    const h = harness({ index: idx, bodies });
    const r = await createLoader(h.deps)(signal());
    expect(r.records.map((x) => x.name)).toEqual(["1", "2", "3"]);
    expect(r).toMatchObject({ offline: false, unverified: false, retryInMs: null });
    expect(h.fetchShard.mock.calls.every((c) => c[1] === true)).toBe(true);
    expect(h.writeCache).toHaveBeenCalledTimes(1);
    expect(h.writeCache).toHaveBeenCalledWith(idx, [packOf("data_001.jsonl"), packOf("data_002.jsonl")]);
  });

  it("offers a shard that came over the plain path to the cache as null", async () => {
    const { index: idx, bodies } = await index("t1", [["1"], ["2"]]);
    const h = harness({ index: idx, bodies, plainPath: new Set(["data_002.jsonl"]) });
    await createLoader(h.deps)(signal());
    expect(h.writeCache).toHaveBeenCalledWith(idx, [packOf("data_001.jsonl"), null]);
  });

  it("fetches no shard when the cached generation is current", async () => {
    const { index: idx, bodies } = await index("t1", [["1"]]);
    const cached = { index: idx, records: [{ name: "cached" } as GameRecord] };
    const h = harness({ index: idx, bodies, cached });
    const r = await createLoader(h.deps)(signal());
    expect(r.records).toBe(cached.records);
    expect(h.fetchShard).not.toHaveBeenCalled();
    expect(h.decode).toHaveBeenCalledTimes(1);
  });

  it("does not open the cache just to find it is an older generation", async () => {
    const old = await index("t1", [["1"]]);
    const next = await index("t2", [["2"]]);
    const h = harness({ index: next.index, bodies: next.bodies, cached: { index: old.index, records: [{ name: "1" } as GameRecord] } });
    const r = await createLoader(h.deps)(signal());
    expect(r.records.map((x) => x.name)).toEqual(["2"]);
    expect(h.decode).not.toHaveBeenCalled();
  });

  it("treats a cache that will not open as a miss", async () => {
    const { index: idx, bodies } = await index("t1", [["1"]]);
    const h = harness({ index: idx, bodies, cached: { index: idx, records: [], corrupt: true } });
    const r = await createLoader(h.deps)(signal());
    expect(r.records.map((x) => x.name)).toEqual(["1"]);
    expect(h.fetchShard).toHaveBeenCalledTimes(1);
    expect(h.writeCache).toHaveBeenCalledTimes(1);
  });

  it("fetches no shard when the in-memory generation is current", async () => {
    const { index: idx, bodies } = await index("t1", [["1"]]);
    const current = { index: idx, records: [{ name: "memory" } as GameRecord] };
    const h = harness({ index: idx, bodies });
    const r = await createLoader(h.deps)(signal(), current);
    expect(r.records).toBe(current.records);
    expect(h.fetchShard).not.toHaveBeenCalled();
  });

  it("never caches a shard whose bytes do not match the index", async () => {
    const old = await index("t1", [["1"]]);
    const next = await index("t2", [["1", "new"]]);
    // The CDN still hands out the previous shard for the new index.
    const h = harness({ index: next.index, bodies: old.bodies, cached: { index: old.index, records: [{ name: "1" } as GameRecord] } });
    const r = await createLoader(h.deps)(signal());
    expect(h.writeCache).not.toHaveBeenCalled();
    expect(r.index.last_updated).toBe("t1");
    expect(r.retryInMs).toBe(60_000);
  });

  it("keeps the held generation while the Worker says the shard is not ready", async () => {
    const old = await index("t1", [["1"]]);
    const next = await index("t2", [["2"]]);
    const current = { index: old.index, records: [{ name: "1" } as GameRecord] };
    const h = harness({ index: next.index, bodies: next.bodies, notReady: new Set(["data_001.jsonl"]) });
    const r = await createLoader(h.deps)(signal(), current, 2);
    expect(r.records).toBe(current.records);
    expect(r.retryInMs).toBe(240_000);
    expect(h.writeCache).not.toHaveBeenCalled();
  });

  it("with nothing in memory, shows the cached generation while the shard is not ready", async () => {
    const old = await index("t1", [["1"]]);
    const next = await index("t2", [["2"]]);
    const cached = { index: old.index, records: [{ name: "1" } as GameRecord] };
    const h = harness({ index: next.index, bodies: next.bodies, notReady: new Set(["data_001.jsonl"]), cached });
    const r = await createLoader(h.deps)(signal());
    expect(r.records).toBe(cached.records);
    expect(r).toMatchObject({ unverified: false, retryInMs: 60_000 });
    expect(h.writeCache).not.toHaveBeenCalled();
  });

  it("with nothing held, shows unversioned shards but does not cache them", async () => {
    const next = await index("t2", [["2"]]);
    const h = harness({ index: next.index, bodies: next.bodies, notReady: new Set(["data_001.jsonl"]) });
    const r = await createLoader(h.deps)(signal());
    expect(r.records.map((x) => x.name)).toEqual(["2"]);
    expect(r.unverified).toBe(true);
    expect(r.retryInMs).not.toBeNull();
    expect(h.writeCache).not.toHaveBeenCalled();
    expect(h.fetchShard.mock.calls.some((c) => c[1] === false)).toBe(true);
  });

  it("offline: returns the IndexedDB generation, flagged", async () => {
    const old = await index("t1", [["1"]]);
    const cached = { index: old.index, records: [{ name: "1" } as GameRecord] };
    const h = harness({ index: new TypeError("Failed to fetch"), bodies: new Map(), cached });
    const r = await createLoader(h.deps)(signal());
    expect(r.offline).toBe(true);
    expect(r.records).toBe(cached.records);
  });

  it("offline with nothing held rethrows", async () => {
    const h = harness({ index: new TypeError("Failed to fetch"), bodies: new Map() });
    await expect(createLoader(h.deps)(signal())).rejects.toThrow("Failed to fetch");
  });

  it("offline with a cache that will not open rethrows", async () => {
    const old = await index("t1", [["1"]]);
    const h = harness({ index: new TypeError("Failed to fetch"), bodies: new Map(), cached: { index: old.index, records: [], corrupt: true } });
    await expect(createLoader(h.deps)(signal())).rejects.toThrow("Failed to fetch");
  });

  it("a legacy index loads and caches as before", async () => {
    const { index: idx, bodies } = await index("t1", [["1"]], false);
    const h = harness({ index: idx, bodies });
    const r = await createLoader(h.deps)(signal());
    expect(r.records.map((x) => x.name)).toEqual(["1"]);
    expect(h.fetchShard.mock.calls.every((c) => c[1] === false)).toBe(true);
    expect(h.writeCache).toHaveBeenCalledWith(idx, [packOf("data_001.jsonl")]);
  });

  it("without Web Crypto, trusts the Worker's own verification of ?v=", async () => {
    const { index: idx, bodies } = await index("t1", [["1"]]);
    const h = harness({ index: idx, bodies, noCrypto: true });
    const r = await createLoader(h.deps)(signal());
    expect(r.unverified).toBe(false);
    expect(h.writeCache).toHaveBeenCalledTimes(1);
  });
});
