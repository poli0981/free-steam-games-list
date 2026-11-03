import { describe, expect, it } from "vitest";
import { buildIndex } from "./data-store";
import { RandomPicks } from "./random.svelte";
import type { RandomSource } from "./random-pick";
import { SKELETON_TEMPLATE, type GameRecord } from "./schema";

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
    type_game: appid % 2 ? "offline" : "online",
    ...overrides,
  };
}

function catalogue(records: GameRecord[]) {
  return { records, appidIndex: buildIndex(records) };
}

const GAMES = Array.from({ length: 40 }, (_, i) => game(i + 1));

describe("the /random picks", () => {
  it("rolls once when the catalogue arrives, and never again by itself", () => {
    const picks = new RandomPicks(xorshift(1));
    picks.rollOnce(catalogue(GAMES));
    const first = picks.appids;
    expect(first).toHaveLength(5);
    // A revalidation hands over a new catalogue object; the picks stay.
    picks.rollOnce(catalogue([...GAMES]));
    expect(picks.appids).toBe(first);
  });

  it("rolls a set that avoids the games on screen", () => {
    const picks = new RandomPicks(xorshift(2));
    const data = catalogue(GAMES);
    picks.roll(data);
    for (let i = 0; i < 50; i++) {
      const before = new Set(picks.appids);
      picks.roll(data);
      expect(picks.appids).toHaveLength(5);
      expect(picks.appids.some((appid) => before.has(appid))).toBe(false);
    }
  });

  it("keeps the first picks for a smaller count, and adds to them for a larger one", () => {
    const picks = new RandomPicks(xorshift(3));
    const data = catalogue(GAMES);
    picks.roll(data);
    const five = [...picks.appids];
    picks.setCount(3, data);
    expect(picks.appids).toEqual(five.slice(0, 3));
    picks.setCount(5, data);
    expect(picks.appids.slice(0, 3)).toEqual(five.slice(0, 3));
    expect(new Set(picks.appids).size).toBe(5);
    picks.setCount(9, data);
    expect(picks.count).toBe(5);
  });

  it("rolls again within a new type", () => {
    const picks = new RandomPicks(xorshift(4));
    const data = catalogue(GAMES);
    picks.roll(data);
    picks.setType("offline", data);
    const shown = picks.resolve(data);
    expect(shown).toHaveLength(5);
    for (const { record } of shown) expect(record.type_game).toBe("offline");
  });

  it("brings dead games in only when asked", () => {
    const data = catalogue(GAMES.map((g, i) => (i < 30 ? { ...g, is_dead: true } : g)));
    const picks = new RandomPicks(xorshift(5));
    for (let i = 0; i < 20; i++) {
      picks.roll(data);
      for (const { record } of picks.resolve(data)) expect(record.is_dead).toBe(false);
    }
    picks.setIncludeDead(true, data);
    let sawDead = false;
    for (let i = 0; i < 20 && !sawDead; i++) {
      picks.roll(data);
      sawDead = picks.resolve(data).some(({ record }) => record.is_dead);
    }
    expect(sawDead).toBe(true);
  });

  it("uses settings chosen before the catalogue arrived for the first roll", () => {
    const picks = new RandomPicks(xorshift(6));
    picks.setCount(2);
    picks.setType("online");
    expect(picks.appids).toEqual([]);
    const data = catalogue(GAMES);
    picks.rollOnce(data);
    const shown = picks.resolve(data);
    expect(shown).toHaveLength(2);
    for (const { record } of shown) expect(record.type_game).toBe("online");
  });

  it("drops a pick that left the catalogue or turned unsafe, without rolling", () => {
    const picks = new RandomPicks(xorshift(7));
    picks.roll(catalogue(GAMES));
    const [a, b, c, d, e] = picks.appids;
    const next = catalogue(
      GAMES.filter((g) => !g.link.includes(`/app/${a}/`)).map((g) =>
        g.link.includes(`/app/${c}/`) ? { ...g, safe: "n" as const } : g,
      ),
    );
    expect(picks.resolve(next).map((p) => p.appid)).toEqual([b, d, e]);
    expect(picks.appids).toEqual([a, b, c, d, e]);
  });

  it("shows what a small pool has, and nothing from an empty one", () => {
    const picks = new RandomPicks(xorshift(8));
    const three = catalogue(GAMES.slice(0, 3));
    picks.roll(three);
    expect(picks.appids).toHaveLength(3);
    picks.roll(three);
    expect(new Set(picks.appids).size).toBe(3);
    picks.roll(catalogue(GAMES.map((g) => ({ ...g, is_dead: true }))));
    expect(picks.appids).toEqual([]);
  });
});
