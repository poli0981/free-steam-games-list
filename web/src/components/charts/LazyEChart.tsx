import { Suspense } from "react";
import type { EChartsCoreOption } from "echarts/core";
import { lazyWithRetry } from "../../lib/lazy";

// EChart.tsx statically imports echarts/core + echarts-wordcloud (~666 KB).
// This wrapper is the single lazy boundary for all of it: chart components
// import { LazyEChart as EChart } so the echarts chunk only downloads when a
// chart actually mounts — off the critical path of the Dashboard first paint.
// The EChartsCoreOption import above is type-only, so it doesn't re-eagerify
// the chunk.
const Inner = lazyWithRetry(() =>
  import("./EChart").then((m) => ({ default: m.EChart })),
);

interface Props {
  option: EChartsCoreOption;
  height?: number | string;
  className?: string;
}

export function LazyEChart({ height = 360, ...rest }: Props) {
  return (
    <Suspense
      fallback={
        // Fixed-height skeleton — prevents layout shift while echarts loads.
        <div style={{ height }} className="animate-pulse rounded-md bg-muted/40" />
      }
    >
      <Inner height={height} {...rest} />
    </Suspense>
  );
}
