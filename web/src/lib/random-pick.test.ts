import { describe, expect, it } from "vitest";
import { buildIndex } from "./data-store";
import {
  MAX_PICKS,
  PICK_COUNTS,
  buildPool,
  clampCount,
  isEligible,
  randomBelow,
  samplePicks,
  type RandomSource,
} from "./random-pick";
import { SKELETON_TEMPLATE, type GameRecord } from "./schema";

/** Fixed words in order, then a loud failure: a test that draws more than it
 *  planned is a wrong test. */
function replay(...values: number[]): RandomSource {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error("replay: out of values");
    return values[i++];
  };
}

/** xorshift32: deterministic, even enough to compare frequencies, and no
 *  Math.random even in a test. */
function xorshift(seed: number): RandomSource {
  let x = seed | 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x >>> 0;
  };
}

function game(appid: number, overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    ...SKELETON_TEMPLATE,
    link: `https://store.steampowered.com/app/${appid}/`,
    name: `Game ${appid}`,
    type_game: "online",
    ...overrides,
  };
}

function catalogue(records: GameRecord[]) {
  return { records, appidIndex: buildIndex(records) };
}

/** `safe` is typed y/n/?/"", but it is typed in by hand, and the data carries
 *  spellings outside that (safety.ts normalises them). */
function handTyped(safe: string): GameRecord["safe"] {
  return safe as GameRecord["safe"];
}

const ANY = { type: "any", includeDead: false } as const;

describe("randomBelow", () => {
  it("throws away the words that would favour low results", () => {
    // 2^32 % 3 === 1: 0xFFFFFFFF is the one word that would make 0 likelier.
    const next = replay(0xffffffff, 0xfffffffe);
    expect(randomBelow(3, next)).toBe(2);
    expect(() => next()).toThrow(/out of values/);
    // The worst case: just under half of all words are rejected.
    expect(randomBelow(2 ** 31 + 1, replay(2 ** 31 + 1, 5))).toBe(5);
  });

  it("rejects nothing when n divides 2^32", () => {
    expect(randomBelow(4, replay(0xffffffff))).toBe(3);
    expect(randomBelow(2 ** 32, replay(0xffffffff))).toBe(0xffffffff);
    expect(randomBelow(1, replay(123_456))).toBe(0);
  });

  it("fails loudly on a source that never produces a usable word", () => {
    expect(() => randomBelow(3, () => 0xffffffff)).toThrow(/never produced/);
  });

  it("refuses an n it cannot draw from", () => {
    for (const n of [0, -1, 1.5, Number.NaN, 2 ** 32 + 1]) {
      expect(() => randomBelow(n, replay(1))).toThrow(RangeError);
    }
  });

  it("draws from crypto by default, and evenly", () => {
    const bins = new Array<number>(7).fill(0);
    for (let i = 0; i < 70_000; i++) bins[randomBelow(7)]++;
    // 10,000 expected per bin; one standard deviation is about 93.
    for (const count of bins) expect(Math.abs(count - 10_000)).toBeLessThan(600);
  });
});

describe("samplePicks", () => {
  const POOL = Array.from({ length: 100 }, (_, i) => `g${i}`);

  it("never returns the same entry twice, even from a pool that repeats one", () => {
    const picks = samplePicks(["a", "a", "b"], 3, { next: xorshift(1) });
    expect([...picks].sort()).toEqual(["a", "b"]);
  });

  it("returns at most the count, and at most the pool", () => {
    for (const count of [0, -3, Number.NaN]) expect(samplePicks(POOL, count)).toEqual([]);
    expect(samplePicks(POOL, 2.7)).toHaveLength(2);
    expect(samplePicks([], 5)).toEqual([]);
    expect([...samplePicks(["x", "y", "z"], 5)].sort()).toEqual(["x", "y", "z"]);
    for (const id of samplePicks(POOL, 5)) expect(POOL).toContain(id);
  });

  it("avoids the games on screen while enough others remain", () => {
    const avoid = new Set(POOL.slice(0, 5));
    const next = xorshift(2);
    for (let i = 0; i < 1000; i++) {
      const picks = samplePicks(POOL, 5, { avoid, next });
      expect(picks).toHaveLength(5);
      expect(picks.some((id) => avoid.has(id))).toBe(false);
    }
  });

  it("falls back on the games on screen when the pool is too small", () => {
    const pool = ["a", "b", "c", "d", "e", "f", "g"];
    const avoid = new Set(["a", "b", "c", "d", "e"]);
    const picks = samplePicks(pool, 5, { avoid, next: xorshift(3) });
    expect(picks).toHaveLength(5);
    expect(new Set(picks).size).toBe(5);
    // The two fresh ones first, then the shown ones to make up the number.
    expect([...picks.slice(0, 2)].sort()).toEqual(["f", "g"]);
    for (const id of picks.slice(2)) expect(avoid.has(id)).toBe(true);
  });

  it("never picks an excluded entry, even when that leaves fewer", () => {
    const pool = ["a", "b", "c", "d", "e", "f", "g"];
    const exclude = new Set(["a", "b", "c", "d", "e"]);
    expect([...samplePicks(pool, 5, { exclude, next: xorshift(4) })].sort()).toEqual(["f", "g"]);
  });

  it("puts every order equally often", () => {
    const counts = new Map<string, number>();
    const next = xorshift(5);
    for (let i = 0; i < 60_000; i++) {
      const key = samplePicks(["a", "b", "c"], 3, { next }).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(["abc", "acb", "bac", "bca", "cab", "cba"]);
    // 10,000 expected per order; one standard deviation is about 91.
    for (const count of counts.values()) expect(Math.abs(count - 10_000)).toBeLessThan(500);
  });
});

describe("the pool", () => {
  it("leaves out what must never come up", () => {
    const data = catalogue([
      game(1),
      game(2, { status: "delisted" }),
      game(3, { safe: "n" }),
      game(4, { safe: handTyped("no") }),
      game(5, { is_dead: true }),
      game(6, { safe: "y" }),
      game(7, { safe: "" }),
      game(0, { link: "" }),
    ]);
    expect(buildPool(data, ANY)).toEqual(["1", "6", "7"]);
    expect(buildPool(data, { ...ANY, includeDead: true })).toEqual(["1", "5", "6", "7"]);
  });

  it("narrows to one type", () => {
    const data = catalogue([game(1), game(2, { type_game: "offline" }), game(3, { type_game: "" })]);
    expect(buildPool(data, ANY)).toEqual(["1", "2", "3"]);
    expect(buildPool(data, { ...ANY, type: "online" })).toEqual(["1"]);
    expect(buildPool(data, { ...ANY, type: "offline" })).toEqual(["2"]);
  });

  it("lists an appid once, however many records carry it", () => {
    const data = catalogue([game(1), game(2), game(1, { name: "Again" })]);
    expect(buildPool(data, ANY)).toEqual(["1", "2"]);
  });

  it("judges a single record the same way", () => {
    expect(isEligible(game(1), ANY)).toBe(true);
    expect(isEligible(game(1, { safe: handTyped(" N ") }), ANY)).toBe(false);
    expect(isEligible(game(1, { is_dead: true }), { ...ANY, includeDead: true })).toBe(true);
    expect(isEligible(game(1, { type_game: "offline" }), { ...ANY, type: "online" })).toBe(false);
  });
});

describe("clampCount", () => {
  it("keeps the count between one and the maximum", () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(-2)).toBe(1);
    expect(clampCount(3.9)).toBe(3);
    expect(clampCount(7)).toBe(MAX_PICKS);
    expect(clampCount(Number.NaN)).toBe(MAX_PICKS);
  });

  it("matches what the control offers", () => {
    expect(Math.max(...PICK_COUNTS)).toBe(MAX_PICKS);
    expect(PICK_COUNTS.map(clampCount)).toEqual([...PICK_COUNTS]);
  });
});
