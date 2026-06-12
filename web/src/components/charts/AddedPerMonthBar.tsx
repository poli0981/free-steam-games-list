import { useMemo } from "react";
import { LazyEChart as EChart } from "./LazyEChart";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
}

export function AddedPerMonthBar({ records, height = 400 }: Props) {
  const option = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of records) {
      const t = r.added_at;
      if (!t || t.length < 7) continue;
      const month = t.slice(0, 7);
      buckets.set(month, (buckets.get(month) ?? 0) + 1);
    }
    const sorted = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const labels = sorted.map(([m]) => m);
    const counts = sorted.map(([, c]) => c);

    return {
      grid: { left: 48, right: 24, top: 24, bottom: 56 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v: number) => v.toLocaleString(),
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: "#94a3b8", rotate: 45, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#94a3b8" },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.15)" } },
      },
      series: [
        {
          type: "bar",
          data: counts,
          itemStyle: { color: "#22c55e", borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 32,
        },
      ],
    };
  }, [records]);

  return <EChart option={option} height={height} />;
}
