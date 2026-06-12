import { useMemo } from "react";
import { LazyEChart as EChart } from "./LazyEChart";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
}

export function AddedCumulativeLine({ records, height = 380 }: Props) {
  const option = useMemo(() => {
    const dates = records
      .map((r) => r.added_at)
      .filter((d): d is string => !!d)
      .sort();
    if (dates.length === 0) return { series: [] };

    const buckets = new Map<string, number>();
    for (const iso of dates) {
      const day = iso.slice(0, 10);
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
    const sortedDays = Array.from(buckets.keys()).sort();
    const xs = sortedDays;
    const ys: number[] = [];
    let total = 0;
    for (const d of sortedDays) {
      total += buckets.get(d) ?? 0;
      ys.push(total);
    }
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 50, right: 30, top: 30, bottom: 50 },
      xAxis: {
        type: "category",
        data: xs,
        axisLabel: { color: "#94a3b8", rotate: 30, fontSize: 10 },
      },
      yAxis: { type: "value", axisLabel: { color: "#94a3b8" } },
      series: [
        {
          type: "line",
          data: ys,
          smooth: true,
          areaStyle: { color: "rgba(96,165,250,0.2)" },
          lineStyle: { color: "#60a5fa", width: 2 },
          itemStyle: { color: "#60a5fa" },
          showSymbol: false,
        },
      ],
    };
  }, [records]);

  return <EChart option={option} height={height} />;
}
