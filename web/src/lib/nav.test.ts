import { describe, expect, it } from "vitest";
import { CHART_PAGES } from "./chart-nav";
import { EXTRA, PRIMARY, SECONDARY, paletteRoutes } from "./nav";

/**
 * The command palette renders its route list in a KEYED each. A duplicate key
 * throws in a Svelte 5 production build, so one path listed twice across these
 * arrays made Ctrl-K crash the moment it opened.
 */
describe("navigation lists", () => {
  it("the palette list has unique paths", () => {
    const paths = paletteRoutes(CHART_PAGES).map((r) => r.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("the palette still offers every destination", () => {
    const all = new Set([...PRIMARY, ...CHART_PAGES, ...SECONDARY, ...EXTRA].map((r) => r.to));
    expect(paletteRoutes(CHART_PAGES).map((r) => r.to).sort()).toEqual([...all].sort());
  });

  it("the sidebar lists have unique paths", () => {
    const paths = [...PRIMARY, ...SECONDARY].map((r) => r.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("publishers is reachable from the sidebar", () => {
    expect(PRIMARY.some((r) => r.to === "/publishers")).toBe(true);
  });
});
