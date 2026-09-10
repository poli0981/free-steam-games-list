import * as echarts from "echarts/core";
import {
  BarChart,
  PieChart,
  LineChart,
  TreemapChart,
  HeatmapChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  DatasetComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
// ESM build (esm/), NOT lib/ (CommonJS): under Vite 8 / Rolldown the CJS
// default-interop wrapped lib/core's `module.exports = class` into a
// namespace object, so `<ReactEChartsCore/>` rendered an object → React
// error #130. The esm/ build has a clean `export default`, fixing it.
import ReactEChartsCore from "echarts-for-react/esm/core";
import { useMemo } from "react";
import { chartTheme } from "../../lib/chart-theme";
import type { EChartsCoreOption } from "echarts/core";
import "echarts-wordcloud";

echarts.use([
  BarChart,
  PieChart,
  LineChart,
  TreemapChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  DatasetComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

// Touch devices (phones, the Android webview) report `pointer: coarse`. Only
// there do we add an inside dataZoom, so many-category charts can be pinch-
// zoomed/panned. Desktop (`pointer: fine`) is left untouched — no mouse-wheel
// zoom hijacking the page scroll.
const IS_TOUCH =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

function axisType(axis: unknown): string | undefined {
  if (Array.isArray(axis)) return (axis[0] as { type?: string } | undefined)?.type;
  return (axis as { type?: string } | undefined)?.type;
}

/**
 * On touch, give cartesian charts an inside dataZoom on their *category* axis
 * (the one prone to cramped ticks). No-op for pie/treemap/wordcloud (no axes)
 * and for charts that already declare a dataZoom of their own.
 */
function withTouchZoom(option: EChartsCoreOption): EChartsCoreOption {
  if (!IS_TOUCH) return option;
  const o = option as Record<string, unknown>;
  if (o.dataZoom) return option;
  if (!o.xAxis && !o.yAxis) return option; // pie / treemap / wordcloud
  const yIsCategory = axisType(o.yAxis) === "category";
  const xIsCategory = axisType(o.xAxis) === "category";
  // Horizontal bars carry the category on Y; everything else on X.
  const zoom =
    yIsCategory && !xIsCategory
      ? { type: "inside", yAxisIndex: 0, filterMode: "none" }
      : { type: "inside", xAxisIndex: 0, filterMode: "none" };
  return { ...option, dataZoom: [zoom] };
}

interface Props {
  option: EChartsCoreOption;
  height?: number | string;
  className?: string;
}

export function EChart({ option, height = 360, className }: Props) {
  const opts = useMemo(() => {
    const base = withTouchZoom(option) as Record<string, unknown>;
    const theme = chartTheme();
    // Dark tooltip defaults. These used to come from the built-in "dark"
    // theme; that theme never registers under `echarts/core` (see the note on
    // <ReactEChartsCore> below), so we supply them here instead. Spread the
    // caller's tooltip LAST so per-chart `formatter`/`trigger` still win.
    const tooltip = {
      backgroundColor: theme.card,
      borderColor: theme.border,
      borderWidth: 1,
      textStyle: { color: theme.text, fontSize: 12 },
      ...((base.tooltip as Record<string, unknown> | undefined) ?? {}),
    };
    return {
      // `color` is ECharts' default categorical palette. Charts that set their
      // own itemStyle still win; this only supplies a themed default so a new
      // series does not fall back to ECharts' stock colours.
      color: theme.series,
      ...base,
      tooltip,
      backgroundColor: "transparent",
      textStyle: {
        fontFamily: "Inter, system-ui, sans-serif",
        color: theme.mutedText,
      },
    };
  }, [option]);
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={opts}
      style={{ height, width: "100%" }}
      className={className}
      // NO `theme="dark"` HERE. `echarts/core` ships no registered themes —
      // only the full `echarts` bundle self-registers them. Passing an
      // unregistered theme name was tolerated by echarts 5, but under
      // echarts 6 it silently stops every series from painting: axes, grid
      // and legend still draw, so the chart looks "empty" rather than
      // broken, and nothing is logged. It cost a full bisect to find.
      // Every chart in charts/ sets its own colors explicitly, so dropping
      // the theme changes nothing visually. If a real theme is wanted, use
      // echarts.registerTheme(name, obj) above and pass that name.
      notMerge
      lazyUpdate
    />
  );
}
