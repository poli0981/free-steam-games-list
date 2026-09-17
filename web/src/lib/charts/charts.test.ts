import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards for the two ECharts `[Violation]` warnings this app was reported with,
 * and for the one workaround that fixes the second of them.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(svelte|ts)$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Source with comments stripped, so prose about a pattern is not mistaken for
 *  a use of it. */
function code(file: string): string {
  return readFileSync(file, "utf-8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("no chart depends on the mouse wheel", () => {
  /**
   * EChart.svelte forces zrender's wheel listeners passive, which is what
   * removes Chrome's scroll-blocking violation - and a passive listener cannot
   * call preventDefault(). These two options are the ones that need it.
   *
   * If a future chart wants wheel zoom or a roamable map, this test fails
   * first, which is the point: the alternative is a chart that silently stops
   * zooming and no clue why.
   */
  const files = walk(SRC);

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('uses no inside dataZoom', () => {
    const offenders = files.filter((f) => /dataZoom/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("uses no roam", () => {
    const offenders = files.filter((f) => /\broam:\s*true/.test(code(f)));
    expect(offenders).toEqual([]);
  });
});

describe("registered components", () => {
  /**
   * An option that uses an unregistered component is silently ignored - the
   * /stats scatter's diagonal reference line never drew, because markLine was
   * used and MarkLineComponent was not registered in echarts.ts.
   */
  const REQUIRES: Record<string, string> = {
    markLine: "MarkLineComponent",
    markPoint: "MarkPointComponent",
    markArea: "MarkAreaComponent",
    legend: "LegendComponent",
    visualMap: "VisualMapComponent",
    tooltip: "TooltipComponent",
    dataset: "DatasetComponent",
    title: "TitleComponent",
    toolbox: "ToolboxComponent",
  };
  const registry = code(join(SRC, "lib", "charts", "echarts.ts"));
  const used = walk(SRC)
    .filter((f) => !f.endsWith("echarts.ts"))
    .map((f) => code(f))
    .filter((text) => /chartTheme\(|<EChart\b/.test(text));

  it("every option key used by a chart has its component registered", () => {
    const missing = Object.entries(REQUIRES)
      .filter(([key]) => used.some((text) => new RegExp(`\\b${key}:\\s*[{\\[]`).test(text)))
      .filter(([, component]) => !new RegExp(`\\b${component},`).test(registry))
      .map(([key, component]) => `${key} needs ${component}`);
    expect(missing).toEqual([]);
  });
});

describe("grid layout", () => {
  it("uses gridBox() rather than containLabel", () => {
    // In echarts 6 containLabel reserves room for tick labels but NOT axis
    // names, which is how the /stats scatter lost both of its axis titles.
    // chart-theme.ts gridBox() contains "all".
    const offenders = walk(SRC).filter(
      (f) => !f.endsWith("chart-theme.ts") && /containLabel/.test(code(f)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("EChart.svelte", () => {
  const src = code(join(SRC, "lib", "charts", "EChart.svelte"));

  it("restores addEventListener even if init throws", () => {
    // Without the finally, one echarts failure would leave every wheel
    // listener on the page silently passive for the rest of the session.
    expect(src).toMatch(/finally\s*\{\s*proto\.addEventListener = original;/);
  });

  it("gates init behind IntersectionObserver", () => {
    // This is what took the reported "[Violation] setTimeout handler took
    // 122ms" to zero long tasks: a page with four charts no longer pays four
    // inits in one frame.
    expect(src).toContain("IntersectionObserver");
  });

  it("keeps chart in reactive state", () => {
    // A plain `let chart` meant the setOption effect ran once while it was
    // undefined and never again: echarts initialised, built its container and
    // painted no canvas - indistinguishable from the unregistered-theme bug.
    expect(src).toMatch(/let chart = \$state</);
  });

  it("passes no theme name to init", () => {
    // echarts/core registers no themes; under echarts 6 an unknown theme name
    // silently stops every series painting while axes and legend still draw.
    expect(src).not.toMatch(/echarts\.init\([^)]*["'](dark|light)["']/);
  });
});
