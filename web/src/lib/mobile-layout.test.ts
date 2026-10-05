import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { withoutBlockComments } from "./testing/source";

/**
 * Layout rules for a phone-width screen. Both were found broken on a 360px
 * Android phone in 4.1.0; CLAUDE.md, "Frontend gotchas", has the story.
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

describe("the app keeps clear of the Android system bars", () => {
  /**
   * targetSdk 36 draws the webview under the status bar and the navigation
   * bar. The React shell padded all four safe-area insets; the SvelteKit
   * rewrite kept only the bottom one, and the top bar of every 2.x app sat
   * under the clock. docs/android-support.md promises this.
   */
  const layout = readFileSync(join(SRC, "routes", "+layout.svelte"), "utf-8");
  const css = readFileSync(join(SRC, "styles", "theme.css"), "utf-8");
  const lists = classLists(withoutBlockComments(layout));
  const find = (marker: string) => lists.find((tokens) => tokens.includes(marker)) ?? [];

  it("pads the shell, the page and the drawer", () => {
    expect(find("h-dvh")).toEqual(expect.arrayContaining(["pt-safe", "pl-safe", "pr-safe"]));
    expect(find("scrollbar-page")).toEqual(expect.arrayContaining(["pb-safe"]));
    expect(find("w-72")).toEqual(expect.arrayContaining(["pt-safe", "pb-safe"]));
  });

  it("defines the padding utilities from env(safe-area-inset-*)", () => {
    for (const side of ["top", "bottom", "left", "right"]) {
      const name = `p${side[0]}-safe`;
      expect(css).toMatch(
        new RegExp(`@utility ${name} \\{\\s*padding-${side}: env\\(safe-area-inset-${side}, 0px\\);`),
      );
    }
  });

  it("puts the status-bar strip on the page", () => {
    expect(withoutBlockComments(layout)).toMatch(/<div class="status-bar-strip" aria-hidden="true"><\/div>/);
  });

  it("paints the strip in the SYSTEM theme's background, light and dark", () => {
    // The status-bar icons follow the system theme (enableEdgeToEdge() uses
    // SystemBarStyle.auto), so the strip uses the two --background tokens
    // keyed on prefers-color-scheme, never the reader's choice in Settings.
    const token = (selector: string) =>
      css.match(new RegExp(`(?:^|\\n)${selector} \\{[^}]*?--background: ([^;]+);`))?.[1];
    const light = token(":root");
    const dark = token("\\.dark");
    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();

    const strip = css.slice(css.indexOf("@utility status-bar-strip {"));
    const block = strip.slice(0, strip.indexOf("\n}\n") + 2);
    expect(block).toContain(`background-color: hsl(${light});`);
    expect(block).toMatch(
      new RegExp(`@media \\(prefers-color-scheme: dark\\) \\{\\s*background-color: hsl\\(${dark}\\);`),
    );
  });
});
