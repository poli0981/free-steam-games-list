import { describe, expect, it } from "vitest";
import { jumpsToGames } from "./header-search";

describe("jumpsToGames", () => {
  it("jumps from another page once there is text", () => {
    expect(jumpsToGames("apex", "/charts", false)).toBe(true);
    expect(jumpsToGames("トロイ", "/", false)).toBe(true);
  });

  it("waits while an input method is composing", () => {
    expect(jumpsToGames("と", "/charts", true)).toBe(false);
  });

  it("stays on /games, and on an empty box", () => {
    expect(jumpsToGames("apex", "/games", false)).toBe(false);
    expect(jumpsToGames("apex", "/games/730", false)).toBe(false);
    expect(jumpsToGames("", "/charts", false)).toBe(false);
  });
});
