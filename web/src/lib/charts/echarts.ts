/**
 * ECharts registration, in one place.
 *
 * Tree-shaken `echarts/core` plus an explicit `use()` list, not the full
 * bundle. A chart type that is not registered here renders nothing, so adding a
 * chart means adding its import here too — ScatterChart was added for the
 * retention plot on /stats.
 *
 * Kept out of the Svelte component so the component file has no side effects
 * and the whole ~700 KB graph sits behind one dynamic import boundary.
 */
import * as echarts from "echarts/core";
import {
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
  TreemapChart,
} from "echarts/charts";
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import "echarts-wordcloud";

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
  TreemapChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

/**
 * NEVER pass a theme name to echarts.init() here.
 *
 * `echarts/core` registers no themes — only the full `echarts` bundle
 * self-registers them. echarts 5 tolerated an unknown theme name; echarts 6
 * silently stops every series from painting while axes, grid and legend still
 * draw, so the chart looks "empty" rather than broken and nothing is logged.
 * It cost a full bisect to find once already.
 *
 * Every chart sets its own colours from the design tokens via chartTheme(), so
 * there is nothing a registered theme would add. If one is ever genuinely
 * wanted, call echarts.registerTheme(name, obj) here first and pass THAT name.
 */
export { echarts };
export type { EChartsCoreOption } from "echarts/core";
