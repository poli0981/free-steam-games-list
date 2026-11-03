/**
 * Picking games at random, for /random.
 *
 * Pure: no runes and no catalogue import, so the rules are tested without
 * Svelte, and nothing here pulls in the search index (games/filtering.ts brings
 * Fuse with it - the reason safety.ts is a module of its own).
 *
 * The randomness comes from crypto.getRandomValues, never Math.random. Nothing
 * about a game pick is secret, but SonarCloud reports every Math.random as a
 * security hotspot (S2245), and an unreviewed hotspot fails the quality gate.
 */
import { safeClass } from "./safety";
import type { GameRecord } from "./schema";

/** The most games one roll shows. */
export const MAX_PICKS = 5;
/** What the count control offers. */
export const PICK_COUNTS = [1, 2, 3, 4, 5] as const;

export type TypeChoice = "any" | "online" | "offline";

export interface PoolOptions {
  type: TypeChoice;
  includeDead: boolean;
}

/** What a roll reads of the catalogue. GamesData satisfies it as it is. */
export interface Catalogue {
  readonly records: readonly GameRecord[];
  readonly appidIndex: ReadonlyMap<string, number>;
}

/** A uniformly random integer in [0, 2^32). Injectable, so tests are exact. */
export type RandomSource = () => number;

const word = new Uint32Array(1);
const cryptoRandom: RandomSource = () => crypto.getRandomValues(word)[0];

const RANGE = 2 ** 32;
// The worst case, n = 2^31 + 1, rejects just under half of all words, so 64
// tries in a row fail with probability ~2^-64: only a broken source gets there.
const MAX_TRIES = 64;

/**
 * A uniformly random integer in [0, n).
 *
 * `x % n` on its own favours the low remainders whenever n does not divide
 * 2^32, so the top `2^32 % n` words are thrown away and drawn again.
 */
export function randomBelow(n: number, next: RandomSource = cryptoRandom): number {
  if (!Number.isInteger(n) || n < 1 || n > RANGE) {
    throw new RangeError(`randomBelow(${n}): n must be an integer from 1 to 2^32`);
  }
  const limit = RANGE - (RANGE % n);
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const x = next();
    if (x < limit) return x % n;
  }
  throw new Error("randomBelow: the random source never produced a usable value");
}

/**
 * 0..n-1 in uniformly random order, produced lazily.
 *
 * A Fisher-Yates shuffle that stores only the slots it has swapped: a roll
 * reads five positions out of ~15,000, and shuffling a full copy of the pool
 * for that would be 15,000 writes for five reads.
 */
function* shuffledPositions(n: number, next: RandomSource): Generator<number> {
  const moved = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const j = i + randomBelow(n - i, next);
    const value = moved.get(j) ?? j;
    moved.set(j, moved.get(i) ?? i);
    // Slot i is never read again. Dropping it keeps the map as small as the
    // number of draws, and is also right when j === i.
    moved.delete(i);
    yield value;
  }
}

export interface SampleOptions {
  /** Never picked: the picks being KEPT when the count grows. */
  exclude?: ReadonlySet<string>;
  /** Picked only when too few others remain: the picks a re-roll replaces. */
  avoid?: ReadonlySet<string>;
  next?: RandomSource;
}

/**
 * Up to `count` DISTINCT entries of `pool`, uniformly, in random order.
 *
 * Distinct even when the pool repeats one: the page keys its list on the
 * appid, and a duplicate key in a keyed each throws in a production build.
 */
export function samplePicks(pool: readonly string[], count: number, opts: SampleOptions = {}): string[] {
  const { exclude, avoid, next = cryptoRandom } = opts;
  const want = Math.min(Math.max(Math.trunc(count) || 0, 0), pool.length);
  const fresh: string[] = [];
  if (want === 0) return fresh;

  const held: string[] = [];
  const seen = new Set<string>();
  for (const at of shuffledPositions(pool.length, next)) {
    const id = pool[at];
    if (seen.has(id) || exclude?.has(id)) continue;
    seen.add(id);
    if (avoid?.has(id)) held.push(id);
    else fresh.push(id);
    if (fresh.length === want) return fresh;
  }
  // Too few games besides the ones on screen: make up the number with those,
  // in the order they came up.
  return [...fresh, ...held.slice(0, want - fresh.length)];
}

/** Whether a record may come up at all. */
export function isEligible(r: GameRecord, { type, includeDead }: PoolOptions): boolean {
  if (r.status !== "active") return false;
  // Reviewed and found unsafe: never suggested, whatever the settings.
  if (safeClass(r.safe) === "n") return false;
  if (r.is_dead && !includeDead) return false;
  return type === "any" || r.type_game === type;
}

/**
 * The appids a roll draws from. Read off appidIndex rather than the records:
 * it holds exactly one entry per appid and none for a record without one,
 * which is what a /games/<appid> link needs.
 */
export function buildPool(data: Catalogue, opts: PoolOptions): string[] {
  const out: string[] = [];
  for (const [appid, i] of data.appidIndex) {
    const r = data.records[i];
    if (r && isEligible(r, opts)) out.push(appid);
  }
  return out;
}

/** The count control's value, kept to 1..MAX_PICKS. */
export function clampCount(n: number): number {
  return Number.isFinite(n) ? Math.min(MAX_PICKS, Math.max(1, Math.trunc(n))) : MAX_PICKS;
}
