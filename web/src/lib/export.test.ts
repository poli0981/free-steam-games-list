import { describe, expect, it } from "vitest";
import { csvForExcel, recordsToCsv } from "./export";
import type { GameRecord } from "./schema";

describe("CSV export", () => {
  it("starts with a byte order mark, so Excel reads it as UTF-8", () => {
    const out = csvForExcel("name\nトロイ\n");
    expect(out.codePointAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe("name\nトロイ\n");
    expect([...new TextEncoder().encode(out).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("keeps CJK names as written and quotes only an ASCII comma", () => {
    const game = { link: "https://store.steampowered.com/app/5118700/", name: "//トロイメライ・ノクターン" };
    const other = { link: "https://store.steampowered.com/app/1/", name: "无主之地，银河, again" };
    const [, first, second] = recordsToCsv([game, other] as unknown as GameRecord[]).split("\n");
    expect(first.startsWith("https://store.steampowered.com/app/5118700/,//トロイメライ・ノクターン,")).toBe(true);
    expect(second.startsWith('https://store.steampowered.com/app/1/,"无主之地，银河, again",')).toBe(true);
  });
});
