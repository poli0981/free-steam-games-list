/**
 * Every colour a chart can receive must be one zrender can parse.
 *
 * The browser's canvas accepts far more syntax than zrender's own colour
 * parser, which is older than CSS Color 4 and splits hsl() arguments on commas.
 * That gap produced two production bugs that looked unrelated:
 *
 *   - Space-separated `hsl(38 94% 60%)` PAINTED (the canvas parsed it), but
 *     zrender's hover state could not derive a lighter shade from it, so any
 *     hovered bar, slice or treemap tile lost its fill. The blank "Card Game"
 *     tile on /charts/genres was just the tile under the cursor.
 *   - `hsl(var(--success))` is not a colour to a canvas at all, so the
 *     meaning-bearing tones on five chart pages never painted.
 *
 * These tests run zrender's real parser, not a regex that approximates it.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { color } from "echarts/core";
import { CHART_FALLBACKS, EXTRA_SERIES, hslFromChannels } from "../chart-theme";

const SRC = join(process.cwd(), "src");

function parses(value: string): boolean {
  return color.parse(value) !== undefined && color.lift(value, 0.1) !== undefined;
}

/** `--name: channels;` declarations inside the first block that `selector` opens. */
function tokensIn(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `selector ${selector}`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  const out = new Map<string, string>();
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

describe("hslFromChannels", () => {
  it("converts channel syntax to the comma form", () => {
    expect(hslFromChannels("38 94% 60%")).toBe("hsl(38, 94%, 60%)");
    expect(hslFromChannels(" 204 88% 62% ")).toBe("hsl(204, 88%, 62%)");
    expect(hslFromChannels("38 94% 60% / 0.5")).toBe("hsla(38, 94%, 60%, 0.5)");
    expect(hslFromChannels("38 94% 60% / 50%")).toBe("hsla(38, 94%, 60%, 0.5)");
  });

  it("rejects anything that is not channel syntax", () => {
    expect(hslFromChannels("")).toBeNull();
    expect(hslFromChannels("#fff")).toBeNull();
    expect(hslFromChannels("hsl(38 94% 60%)")).toBeNull();
    expect(hslFromChannels("var(--primary)")).toBeNull();
  });
});

describe("zrender can parse every chart colour", () => {
  it("the space-separated form really is the bug", () => {
    // If a zrender upgrade ever starts accepting this, the conversion can go.
    expect(color.parse("hsl(38 94% 60%)")).toBeUndefined();
    expect(color.parse("hsl(var(--success))")).toBeUndefined();
  });

  it("fallbacks and the extra categorical colours", () => {
    for (const value of [...Object.values(CHART_FALLBACKS), ...EXTRA_SERIES]) {
      expect(parses(value), value).toBe(true);
    }
  });

  it("every colour token, in both themes, after conversion", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf-8");
    let checked = 0;
    for (const selector of [":root", ".dark"]) {
      for (const [name, raw] of tokensIn(css, selector)) {
        // Only colour tokens are channel triplets; radii, fonts and the like
        // simply do not match and are skipped.
        const converted = hslFromChannels(raw);
        if (!converted) continue;
        expect(parses(converted), `${selector} --${name}: ${raw} -> ${converted}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("chart source", () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(svelte|ts)$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
    }
    return out;
  }

  /** Files that build chart options: they use chartTheme or render EChart. */
  const chartFiles = walk(SRC).filter((file) => {
    const text = readFileSync(file, "utf-8");
    return /chartTheme\(|<EChart\b/.test(text) && !file.endsWith("chart-theme.ts");
  });

  it("finds the chart pages", () => {
    expect(chartFiles.length).toBeGreaterThan(10);
  });

  it("puts no CSS variable inside a colour string", () => {
    const offenders: string[] = [];
    for (const file of chartFiles) {
      const text = readFileSync(file, "utf-8");
      // Only string literals: a <style> block may use var(--x) legitimately.
      for (const m of text.matchAll(/["'`]([^"'`\n]*var\(--[^"'`\n]*)["'`]/g)) {
        if (/hsla?\(|rgba?\(|color/.test(m[1])) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every literal colour in chart code parses", () => {
    const bad: string[] = [];
    for (const file of chartFiles) {
      const text = readFileSync(file, "utf-8");
      for (const m of text.matchAll(/["'`]((?:hsla?|rgba?)\([^"'`\n)]*\)|#[0-9a-fA-F]{3,8})["'`]/g)) {
        if (!parses(m[1])) bad.push(`${file}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
