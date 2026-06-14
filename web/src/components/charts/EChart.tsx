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

interface Props {
  option: EChartsCoreOption;
  height?: number | string;
  className?: string;
}

export function EChart({ option, height = 360, className }: Props) {
  const opts = useMemo(
    () => ({
      ...option,
      backgroundColor: "transparent",
      textStyle: {
        fontFamily: "Inter, system-ui, sans-serif",
      },
    }),
    [option],
  );
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={opts}
      style={{ height, width: "100%" }}
      className={className}
      theme="dark"
      notMerge
      lazyUpdate
    />
  );
}
