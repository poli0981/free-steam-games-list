import { describe, expect, it } from "vitest";
import { applyFilters, buildSearchIndex, facets, type FilterCriteria } from "./filtering";
import type { GameRecord } from "../schema";

const NONE: FilterCriteria = {
  search: "",
  genre: null,
  typeGame: null,
  platform: null,
  language: null,
  safe: null,
  status: null,
  hasAntiCheat: null,
  hideDead: false,
};

function game(name: string, languages: string[], extra: Partial<GameRecord> = {}): GameRecord {
  return {
    name,
    languages,
    description: "",
    tags: [],
    developer: [],
    publisher: [],
    platforms: [],
    ...extra,
  } as unknown as GameRecord;
}

const records = [
  game("//トロイメライ・ノクターン", ["Japanese"], { developer: ["shiori-project"] }),
  game("Apex Legends™", ["English", "Japanese", "Korean"], { tags: ["Battle Royale"] }),
  game("无主之地：银河", ["Simplified Chinese"], { tags: ["シューティング"] }),
  game("Untitled", []),
];
const fuse = buildSearchIndex(records);
const names = (c: Partial<FilterCriteria>) => applyFilters(records, fuse, { ...NONE, ...c }).map((g) => g.name);

describe("the language filter", () => {
  it("keeps the games that list the language", () => {
    expect(names({ language: "Japanese" })).toEqual(["//トロイメライ・ノクターン", "Apex Legends™"]);
    expect(names({ language: "Simplified Chinese" })).toEqual(["无主之地：银河"]);
    expect(names({ language: null })).toHaveLength(4);
  });

  it("combines with search", () => {
    expect(names({ language: "Korean", search: "legends" })).toEqual(["Apex Legends™"]);
    expect(names({ language: "Korean", search: "とろい" })).toEqual([]);
  });

  it("counts each language once per game, most common first", () => {
    const withDupe = [...records, game("Twice", ["Japanese", "Japanese"])];
    expect(facets(withDupe).language).toEqual([
      ["Japanese", 3],
      ["English", 1],
      ["Korean", 1],
      ["Simplified Chinese", 1],
    ]);
  });
});

describe("search", () => {
  it("matches across width and kana script, in every key", () => {
    expect(names({ search: "とろい" })).toEqual(["//トロイメライ・ノクターン"]);
    expect(names({ search: "ﾄﾛｲ" })).toEqual(["//トロイメライ・ノクターン"]);
    expect(names({ search: "しゅーてぃんぐ" })).toEqual(["无主之地：银河"]);
    expect(names({ search: "SHIORI" })).toEqual(["//トロイメライ・ノクターン"]);
  });

  it("trims an ideographic space once it is folded", () => {
    expect(names({ search: "　とろい　" })).toEqual(["//トロイメライ・ノクターン"]);
    expect(names({ search: "　" })).toHaveLength(4);
  });

  it("still finds English by name", () => {
    expect(names({ search: "legends" })).toEqual(["Apex Legends™"]);
  });
});
