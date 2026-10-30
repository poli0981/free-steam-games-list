import { describe, expect, it } from "vitest";
import Fuse from "fuse.js";
import { fold, longEnough, searchKey } from "./search-fold";

describe("fold", () => {
  it("makes half-width, hiragana and katakana one script", () => {
    expect(fold("ﾄﾛｲ")).toBe("トロイ");
    expect(fold("とろい")).toBe("トロイ");
    expect(fold("トロイ")).toBe("トロイ");
    expect(fold("ゝゞ")).toBe("ヽヾ");
  });

  it("keeps voiced kana voiced", () => {
    // Fuse's ignoreDiacritics would strip the dakuten: ガ would find カ.
    expect(fold("が")).toBe("ガ");
    expect(fold("が")).not.toBe(fold("か"));
    expect(fold("ｶﾞ")).toBe("ガ");
  });

  it("reads full-width letters, digits and punctuation as ASCII", () => {
    expect(fold("４日後")).toBe("4日後");
    expect(fold("无主之地：银河")).toBe("无主之地:银河");
    expect(fold("ＡＰＥＸ")).toBe("APEX");
  });

  it("leaves ASCII exactly as it was, case included", () => {
    expect(fold("Apex Legends")).toBe("Apex Legends");
    expect(fold("")).toBe("");
  });

  it("is a fixed point", () => {
    for (const s of ["ﾄﾛｲﾒﾗｲ", "とろいめらい", "４日後", "Ｃｏｕｎｔｅｒ"]) expect(fold(fold(s))).toBe(fold(s));
  });
});

describe("searchKey and longEnough", () => {
  it("lowercases after folding", () => {
    expect(searchKey("ＡＰＥＸ Legends")).toBe("apex legends");
    expect(searchKey("//トロイメライ・ノクターン").includes(searchKey("とろいめらい"))).toBe(true);
  });

  it("lets one CJK character through where Latin needs two", () => {
    expect(longEnough("a", 2)).toBe(false);
    expect(longEnough("ab", 2)).toBe(true);
    expect(longEnough("星", 2)).toBe(true);
    expect(longEnough("と", 2)).toBe(true);
    expect(longEnough("한", 2)).toBe(true);
    expect(longEnough("", 2)).toBe(false);
  });
});

describe("fold inside Fuse", () => {
  const records = [
    { name: "//トロイメライ・ノクターン", tags: ["Visual Novel"] },
    { name: "Apex Legends™", tags: ["Battle Royale"] },
    { name: "无主之地：银河", tags: ["シューティング"] },
  ];
  const fuse = new Fuse(records, {
    keys: [
      { name: "name", getFn: (r) => fold(r.name) },
      { name: "tags", getFn: (r) => r.tags.map(fold) },
    ],
    threshold: 0.32,
    ignoreLocation: true,
  });
  const names = (q: string) => fuse.search(fold(q).trim()).map((r) => r.item.name);

  it("finds a name typed in another script or width", () => {
    expect(names("とろい")).toEqual(["//トロイメライ・ノクターン"]);
    expect(names("ﾄﾛｲﾒﾗｲ")).toEqual(["//トロイメライ・ノクターン"]);
    expect(names("无主之地:银河")).toEqual(["无主之地：银河"]);
  });

  it("folds array fields, and still finds English", () => {
    expect(names("しゅーてぃんぐ")).toEqual(["无主之地：银河"]);
    expect(names("legends")).toEqual(["Apex Legends™"]);
  });
});
