/**
 * IndexedDB cache via idb-keyval: ONE verified generation of the catalogue.
 *
 * What counts as the same generation, and when one may be written at all, is
 * games-loader.ts's decision - this file only stores it.
 *
 * WHAT IS STORED is each shard's pack exactly as it arrived from
 * /api/data/p1/ (shared/data-pack.ts) - opaque bytes in a Uint8Array, never
 * parsed records and never the plain JSONL. Like the packs on the wire this is
 * obfuscation and compression (~15% of the JSONL), NOT protection: the key is
 * public, and the dataset is meant to be read from Git. A generation in which
 * any shard came over the plain path is not stored at all; the browser never
 * packs anything itself (compressing ~9.5 MB on the main thread, several times
 * a day, would cost a phone a second each time).
 *
 *   f2p:index    DataIndex, as fetched - public metadata, kept readable so the
 *                generation can be compared without opening anything
 *   f2p:records  Uint8Array[], one pack per index.files entry, in its order
 *
 * The packs live in a database of their own, `f2p-catalogue`. Up to app 2.1.x
 * the same two keys held PARSED records in idb-keyval's default database
 * (`keyval-store`), and a tab still running that code would hand Uint8Arrays to
 * the page if it found them there. That legacy copy is still read - it is a
 * verified generation like any other - until the next generation is written,
 * which deletes it.
 */
import { createStore, delMany, getMany, setMany, type UseStore } from "idb-keyval";
import { packIvHex, packsSupported } from "../../shared/data-pack";
import type { DataIndex, GameRecord } from "./schema";

/** The names docs/PRIVACY_POLICY.md lists. Renaming either means editing that
 *  document, which reopens the consent gate for everyone. */
const KEY_RECORDS = "f2p:records";
const KEY_INDEX = "f2p:index";
const KEYS = [KEY_RECORDS, KEY_INDEX];

const LEGACY_DB = "keyval-store";

export type CachedBundle =
  | { kind: "packs"; index: DataIndex; packs: Uint8Array[] }
  /** Written by app 2.1.x and older; see the header. */
  | { kind: "legacy"; index: DataIndex; records: GameRecord[] };

let packStore: UseStore | undefined;
let legacyStore: UseStore | undefined;

function packs(): UseStore {
  // Lazily: creating a store opens nothing, but this module is imported
  // during prerender too, where there is no IndexedDB at all.
  return (packStore ??= createStore("f2p-catalogue", "keyval"));
}

/**
 * The legacy database, or null when it does not exist. Opening a database
 * creates it, so where the browser can list its databases this looks first:
 * a new visitor never gets an empty `keyval-store` from a check for old data.
 */
async function legacy(): Promise<UseStore | null> {
  if (legacyStore) return legacyStore;
  const idb = globalThis.indexedDB;
  if (!idb) return null;
  if (typeof idb.databases === "function") {
    const dbs = await idb.databases();
    if (!dbs.some((d) => d.name === LEGACY_DB)) return null;
  }
  return (legacyStore = createStore(LEGACY_DB, "keyval"));
}

function isIndex(v: unknown): v is DataIndex {
  if (typeof v !== "object" || v === null) return false;
  const i = v as DataIndex;
  return (
    typeof i.last_updated === "string" &&
    Array.isArray(i.files) &&
    i.files.every((f) => typeof f?.name === "string" && typeof f.count === "number")
  );
}

/**
 * One pack per index entry, each a pack of the shard that entry names: its IV
 * is the shard's sha256 prefix (where the entry records one).
 */
function packsFor(index: DataIndex, v: unknown): v is Uint8Array[] {
  return (
    Array.isArray(v) &&
    v.length === index.files.length &&
    v.every((p, i) => {
      if (!(p instanceof Uint8Array)) return false;
      const iv = packIvHex(p);
      const sha = index.files[i].sha256;
      return iv !== null && (!sha || sha.slice(0, iv.length) === iv);
    })
  );
}

export async function readCache(): Promise<CachedBundle | null> {
  try {
    // Both keys in one transaction: one consistent snapshot, even while
    // another tab is writing the next generation.
    const [records, index] = await getMany<unknown>(KEYS, packs());
    if (isIndex(index) && packsFor(index, records)) return { kind: "packs", index, packs: records };
  } catch {
    /* ignore */
  }
  try {
    const store = await legacy();
    if (!store) return null;
    const [records, index] = await getMany<unknown>(KEYS, store);
    if (isIndex(index) && Array.isArray(records)) {
      return { kind: "legacy", index, records: records as GameRecord[] };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Store a verified generation - if every shard of it arrived packed. Either
 * way the legacy copy goes: it is an older generation in a readable form.
 */
export async function writeCache(index: DataIndex, shards: (Uint8Array | null)[]): Promise<void> {
  // First: it may be what frees the room for the write below.
  await dropLegacy();
  if (!packsSupported() || !packsFor(index, shards)) return;
  try {
    // One transaction, records first: if the first put already fails, the
    // index is never written next to the previous generation's packs.
    await setMany(
      [
        [KEY_RECORDS, shards],
        [KEY_INDEX, index],
      ],
      packs(),
    );
  } catch (err) {
    console.warn("[cache] write failed:", err);
  }
}

export async function clearCache(): Promise<void> {
  await delMany(KEYS, packs());
  await dropLegacy();
}

async function dropLegacy(): Promise<void> {
  try {
    const store = await legacy();
    if (store) await delMany(KEYS, store);
  } catch {
    // Best effort; the next write tries again.
  }
}
