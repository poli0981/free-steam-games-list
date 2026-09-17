/**
 * The catalogue, shared by every page.
 *
 * Replaces the `useGames` / `useRemovedGames` hooks. HOW a generation is
 * fetched, verified and cached lives in games-loader.ts, as a pure function
 * with its own tests; this file wires in the real network, IndexedDB and
 * worker, and decides WHEN to look for newer data.
 *
 * The JSONL is parsed off the main thread in a worker, because parsing ~3,650
 * records blocks it for long enough to drop frames.
 */
import { fetchIndex, fetchShard, rawUrl } from "./fetcher";
import { parseShard } from "./worker-pool";
import { readCache, writeCache } from "./cache";
import { createLoader, type Generation } from "./games-loader";
import { buildIndex, extractAppid } from "./data-store";
import { Resource } from "./resource.svelte";
import type { GameRecord, DataIndex } from "./schema";

export interface GamesData {
  index: DataIndex;
  records: GameRecord[];
  /** appid → position in `records`. Built once; every lookup by appid uses it
   *  rather than scanning 3,700 rows. */
  appidIndex: Map<string, number>;
  /** The index could not be fetched; this is the last generation held. */
  offline: boolean;
  /** Not verified against index.json's hashes, and therefore not cached. */
  unverified: boolean;
  /** Newer data exists upstream but is not available yet. */
  updating: boolean;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string | null> {
  // Absent outside a secure context. tauri.localhost and localhost both count
  // as secure, so in practice this is a guard, not a code path.
  if (!globalThis.crypto?.subtle) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}

const decoder = new TextDecoder();

const load = createLoader({
  fetchIndex: (signal) => fetchIndex(signal),
  fetchShard: (entry, versioned, signal) => fetchShard(entry, versioned, signal),
  hash: sha256Hex,
  parse: (bytes) => parseShard(decoder.decode(bytes)),
  readCache,
  writeCache,
});

/** Failed attempts at the generation currently being waited for. */
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

async function loadAll(signal: AbortSignal): Promise<GamesData> {
  const held = games.data;
  const current: Generation | undefined = held && !held.unverified
    ? { index: held.index, records: held.records }
    : undefined;

  const result = await load(signal, current, attempt);

  clearTimeout(retryTimer);
  if (result.retryInMs !== null) {
    attempt += 1;
    retryTimer = setTimeout(() => void games.revalidate(), result.retryInMs);
  } else {
    attempt = 0;
  }

  const same =
    held &&
    held.records === result.records &&
    held.offline === result.offline &&
    held.unverified === result.unverified &&
    held.updating === (result.retryInMs !== null);
  // The same object back when nothing changed. `data` is $state.raw, so this
  // makes a routine revalidation a no-op for every page that reads it.
  if (same) return held;

  return {
    index: result.index,
    records: result.records,
    appidIndex: held && held.records === result.records ? held.appidIndex : buildIndex(result.records),
    offline: result.offline,
    unverified: result.unverified,
    updating: result.retryInMs !== null,
  };
}

export const games = new Resource<GamesData>(loadAll, { staleTime: 5 * 60 * 1000 });

/**
 * Look for newer data while the app is open.
 *
 * The catalogue used to load exactly once per page load. A tab left open
 * showed that load's data indefinitely - the 3,666-games / 2026-09-12 header
 * in a screenshot taken on 09-17, while the site itself served 3,649 / 09-17.
 *
 * Each check is one ~600-byte index request; shards are fetched only when the
 * generation changed. Checks happen when the tab becomes visible or regains
 * focus or network, at most once a minute, and every ten minutes while it
 * stays visible. Installed from the root layout once consent is given.
 */
export function installGamesRevalidation(): () => void {
  const MIN_GAP = 60_000;
  const INTERVAL = 10 * 60_000;
  let last = Date.now();

  const check = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - last < MIN_GAP) return;
    last = Date.now();
    void games.revalidate();
  };

  const onVisibility = () => check();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  const interval = setInterval(check, INTERVAL);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", check);
    window.removeEventListener("online", check);
    clearInterval(interval);
    clearTimeout(retryTimer);
  };
}

/* ─────────────────────────── removed games ─────────────────────────── */

export interface RemovedGame {
  link: string;
  name: string;
  appid?: string;
  reason: string;
  status_code: "not_free" | "unavailable" | string;
  removed_at: string;
  [extra: string]: unknown;
}

/**
 * Mirrors `dedup_removed` in scripts/core/data_store.py: when an appid appears
 * more than once, keep the row with the most recent `removed_at`. Historic
 * delete flows wrote full game metadata onto these rows, hence the index
 * signature.
 */
function dedup(records: RemovedGame[]): RemovedGame[] {
  const latest = new Map<string, RemovedGame>();
  for (const r of records) {
    const aid = r.appid || extractAppid(r.link);
    if (!aid) continue;
    const prev = latest.get(aid);
    if (!prev || (r.removed_at ?? "") > (prev.removed_at ?? "")) {
      latest.set(aid, r);
    }
  }
  return [...latest.values()];
}

async function loadRemoved(signal: AbortSignal): Promise<RemovedGame[]> {
  const res = await fetch(rawUrl("scripts/removed_games.jsonl"), {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch removed_games.jsonl: ${res.status}`);
  }
  const out: RemovedGame[] = [];
  for (const line of (await res.text()).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RemovedGame);
    } catch {
      // One malformed line must not lose the rest of the file.
    }
  }
  return dedup(out);
}

export const removedGames = new Resource<RemovedGame[]>(loadRemoved, {
  staleTime: 5 * 60 * 1000,
});
