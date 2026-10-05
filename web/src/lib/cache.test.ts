import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packBytes, sha256 } from "../../shared/data-pack";
import type { DataIndex, GameRecord } from "./schema";

/**
 * What lib/cache.ts promises: the catalogue sits in IndexedDB as the packs it
 * arrived in - opaque bytes, never records or plain JSONL - in one consistent
 * write; a stored pack must be the shard its index entry names; and the
 * readable copy older app versions left behind is read until the next
 * generation, which deletes it, without ever creating that database.
 *
 * idb-keyval is replaced by an in-memory one. Like IndexedDB, it creates a
 * database the first time anything opens it.
 */
const idb = vi.hoisted(() => {
  const dbs = new Map<string, Map<unknown, unknown>>();
  const open = (name: string) => {
    if (!dbs.has(name)) dbs.set(name, new Map());
    return dbs.get(name)!;
  };
  return { dbs, open, setMany: [] as [unknown, unknown][][] };
});

vi.mock("idb-keyval", () => ({
  createStore: (db: string) => db,
  getMany: async (keys: unknown[], store: string) => keys.map((k) => idb.open(store).get(k)),
  setMany: async (entries: [unknown, unknown][], store: string) => {
    idb.setMany.push(entries);
    for (const [k, v] of entries) idb.open(store).set(k, v);
  },
  delMany: async (keys: unknown[], store: string) => {
    for (const k of keys) idb.open(store).delete(k);
  },
}));

const NEW_DB = "f2p-catalogue";
const LEGACY_DB = "keyval-store";

let cache: typeof import("./cache");

beforeEach(async () => {
  idb.dbs.clear();
  idb.setMany.length = 0;
  vi.stubGlobal("indexedDB", {
    databases: async () => [...idb.dbs.keys()].map((name) => ({ name, version: 1 })),
  });
  // The module remembers its store handles; every test starts from none.
  vi.resetModules();
  cache = await import("./cache");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const enc = new TextEncoder();

async function generation(stamp: string, shards: string[][]) {
  const packs: Uint8Array[] = [];
  const files: DataIndex["files"] = [];
  for (const [i, names] of shards.entries()) {
    const text = names.map((n) => JSON.stringify({ link: `https://store.steampowered.com/app/${n}/`, name: `Game ${n}` })).join("\n") + "\n";
    const plain = enc.encode(text);
    const digest = await sha256(plain);
    packs.push(await packBytes(plain, digest));
    files.push({
      name: `data_00${i + 1}.jsonl`,
      count: names.length,
      sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""),
    });
  }
  const index: DataIndex = { max_per_file: 800, total: shards.flat().length, last_updated: stamp, files };
  return { index, packs };
}

function seedLegacy(index: DataIndex, records: GameRecord[]) {
  idb.open(LEGACY_DB).set("f2p:records", records).set("f2p:index", index);
}

describe("cache", () => {
  it("stores the packs as they arrived: Uint8Arrays with no game data readable", async () => {
    const { index, packs } = await generation("t1", [["730", "570"], ["440"]]);
    await cache.writeCache(index, packs);

    const stored = idb.dbs.get(NEW_DB)!;
    const records = stored.get("f2p:records") as Uint8Array[];
    expect(records).toHaveLength(2);
    for (const p of records) {
      expect(p).toBeInstanceOf(Uint8Array);
      const text = new TextDecoder().decode(p);
      expect(text).not.toContain("Game ");
      expect(text).not.toContain("steampowered");
    }
    expect(stored.get("f2p:index")).toEqual(index);
  });

  it("writes both keys in one transaction, the packs first", async () => {
    const { index, packs } = await generation("t1", [["730"]]);
    await cache.writeCache(index, packs);
    expect(idb.setMany).toHaveLength(1);
    expect(idb.setMany[0].map(([k]) => k)).toEqual(["f2p:records", "f2p:index"]);
  });

  it("reads back exactly what it wrote", async () => {
    const { index, packs } = await generation("t1", [["730"], ["570"]]);
    await cache.writeCache(index, packs);
    expect(await cache.readCache()).toEqual({ kind: "packs", index, packs });
  });

  it("is a miss when a stored pack is not the shard its index entry names", async () => {
    const { index, packs } = await generation("t1", [["730"], ["570"]]);
    await cache.writeCache(index, packs);
    const stored = idb.dbs.get(NEW_DB)!;

    // The same packs under the wrong entries.
    stored.set("f2p:records", [packs[1], packs[0]]);
    expect(await cache.readCache()).toBeNull();

    // One pack short.
    stored.set("f2p:records", [packs[0]]);
    expect(await cache.readCache()).toBeNull();

    // Not a pack at all: plain JSONL, as no version ever stored here.
    stored.set("f2p:records", [enc.encode('{"link":"x"}\n'), packs[1]]);
    expect(await cache.readCache()).toBeNull();
  });

  it("refuses to store a generation in which any shard came over the plain path", async () => {
    const { index, packs } = await generation("t1", [["730"], ["570"]]);
    await cache.writeCache(index, [packs[0], null]);
    expect(idb.setMany).toHaveLength(0);
    expect(idb.dbs.get(NEW_DB)?.get("f2p:records")).toBeUndefined();
  });

  it("refuses to store packs where they could not be opened again", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    const { index, packs } = await generation("t1", [["730"]]);
    await cache.writeCache(index, packs);
    expect(idb.setMany).toHaveLength(0);
  });

  it("reads the legacy copy only while the new store is empty, and deletes it on the next write", async () => {
    const old = await generation("t0", [["730"]]);
    const legacyRecords = [{ name: "Game 730" } as GameRecord];
    seedLegacy(old.index, legacyRecords);
    expect(await cache.readCache()).toEqual({ kind: "legacy", index: old.index, records: legacyRecords });

    const next = await generation("t1", [["730", "570"]]);
    await cache.writeCache(next.index, next.packs);
    expect(idb.dbs.get(LEGACY_DB)!.size).toBe(0);
    expect((await cache.readCache())?.kind).toBe("packs");
  });

  it("deletes the legacy copy even when there is nothing it may store", async () => {
    const old = await generation("t0", [["730"]]);
    seedLegacy(old.index, [{ name: "Game 730" } as GameRecord]);
    const next = await generation("t1", [["570"]]);
    await cache.writeCache(next.index, [null]);
    expect(idb.dbs.get(LEGACY_DB)!.size).toBe(0);
  });

  it("never creates the legacy database for a visitor who has none", async () => {
    expect(await cache.readCache()).toBeNull();
    const { index, packs } = await generation("t1", [["730"]]);
    await cache.writeCache(index, packs);
    await cache.clearCache();
    expect(idb.dbs.has(LEGACY_DB)).toBe(false);
  });

  it("clearCache empties both stores", async () => {
    const old = await generation("t0", [["730"]]);
    seedLegacy(old.index, [{ name: "Game 730" } as GameRecord]);
    const { index, packs } = await generation("t1", [["570"]]);
    idb.open(NEW_DB).set("f2p:records", packs).set("f2p:index", index);

    await cache.clearCache();
    expect(idb.dbs.get(NEW_DB)!.size).toBe(0);
    expect(idb.dbs.get(LEGACY_DB)!.size).toBe(0);
    expect(await cache.readCache()).toBeNull();
  });
});
