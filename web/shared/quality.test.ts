import { describe, expect, it } from "vitest";
import { qualityIssues, safeClass as adminSafeClass, QUALITY_CHECKS, QUALITY_GROUPS } from "./quality";
import { safeClass as publicSafeClass } from "../src/lib/safety";

describe("safeClass", () => {
  it("classifies exactly as the public app does", () => {
    for (const v of ["y", "Y", " yes ", "n", "No", "", "  ", "?", "maybe", null, undefined]) {
      expect(adminSafeClass(v)).toBe(publicSafeClass(v as string | null | undefined));
    }
  });
});

describe("qualityIssues", () => {
  const complete = {
    link: "https://store.steampowered.com/app/1/",
    header_image: "h.jpg",
    description: "d",
    tags: ["t"],
    languages: ["English"],
    language_details: [{ name: "English" }],
    developer: ["D"],
    publisher: ["P"],
    release_date: "Aug 21, 2012",
    genre: "Action",
    type_game: "online",
    anti_cheat: "-",
    safe: "y",
  };

  it("finds nothing on a complete record", () => {
    expect(qualityIssues(complete)).toEqual([]);
  });

  it("tells a never-set anti-cheat from an explicit 'none'", () => {
    expect(qualityIssues({ ...complete, anti_cheat: "" })).toEqual(["online-no-anticheat"]);
    expect(qualityIssues({ ...complete, type_game: "offline", anti_cheat: "" })).toEqual([]);
    expect(qualityIssues({ ...complete, anti_cheat: "EAC", is_kernel_ac: null })).toEqual(["kernel-unknown"]);
    expect(qualityIssues({ ...complete, anti_cheat: "EAC", is_kernel_ac: false })).toEqual([]);
  });

  it("counts lists of blanks as empty", () => {
    expect(qualityIssues({ ...complete, developer: [""], publisher: [], language_details: [] })).toEqual([
      "no-languages",
      "no-developer",
      "no-publisher",
    ]);
  });

  it("labels every check and every group", () => {
    const groups = new Set(QUALITY_GROUPS.map((g) => g.key));
    for (const c of QUALITY_CHECKS) expect(groups.has(c.group)).toBe(true);
    expect(new Set(QUALITY_CHECKS.map((c) => c.key)).size).toBe(QUALITY_CHECKS.length);
  });
});
