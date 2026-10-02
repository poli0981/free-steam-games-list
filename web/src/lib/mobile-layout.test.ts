import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { withoutBlockComments } from "./testing/source";

/**
 * Layout rules for a phone-width screen, found broken on a 360px Android
 * phone in 4.1.0; CLAUDE.md, "Frontend gotchas", has the story.
 */

const SRC = join(__dirname, "..");

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return svelteFiles(full);
    return name.endsWith(".svelte") ? [full] : [];
  });
}

/** Every class list in a component: `class="…"` and the string literals of a
 *  `class={cn(…)}` expression. */
function classLists(text: string): string[][] {
  const lists: string[] = [];
  for (const m of text.matchAll(/\bclass=(?:"([^"]*)"|\{([^}]*)\})/g)) {
    if (m[1] !== undefined) lists.push(m[1]);
    else for (const lit of m[2].matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) lists.push(lit[1] ?? lit[2] ?? lit[3]);
  }
  return lists.map((list) => list.trim().split(/\s+/));
}

describe("layout grids declare their base column count", () => {
  /**
   * `grid gap-2 sm:grid-cols-2` has NO columns below sm: one implicit `auto`
   * track, as wide as its widest item's min-content. A `truncate` name counts
   * at full length there - the grid item keeps min-width:auto, whatever the
   * span inside it says - so one long studio name pushed every card on
   * /publishers past the edge of a phone, and a chart in such a grid (zrender
   * gives its root a pixel width) then held the track at that width.
   * `grid-cols-N` is repeat(N, minmax(0, 1fr)) and cannot do either.
   */
  const grids = svelteFiles(SRC).flatMap((file) =>
    classLists(withoutBlockComments(readFileSync(file, "utf-8")))
      .filter(
        (tokens) =>
          tokens.includes("grid") &&
          tokens.some((t) => t.startsWith("gap-") || t.includes(":grid-cols-")),
      )
      .map((tokens) => `${relative(SRC, file).replace(/\\/g, "/")}: ${tokens.join(" ")}`),
  );

  it("finds the layout grids", () => {
    // Guards a scanner that silently matches nothing.
    expect(grids.length).toBeGreaterThanOrEqual(20);
  });

  it("gives every one an unprefixed grid-cols-N", () => {
    expect(grids.filter((g) => !/\sgrid-cols-\d+(\s|$)/.test(g))).toEqual([]);
  });
});
