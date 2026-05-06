import { useMemo } from "react";
import { EChart } from "./EChart";
import { parseReviewPercent } from "../../lib/utils";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
}

const BIN_COUNT = 10;

function colorFor(start: number): string {
  if (start >= 80) return "#22c55e";
  if (start >= 70) return "#84cc16";
  if (start >= 50) return "#f59e0b";
  if (start >= 30) return "#f97316";
  return "#f43f5e";
}

export function ReviewsHistogram({ records, height = 380 }: Props) {
  const option = useMemo(() => {
    const bins: number[] = new Array(BIN_COUNT).fill(0);
    for (const r of records) {
      const p = parseReviewPercent(r.reviews);
      if (p === null) continue;
      const idx = Math.min(BIN_COUNT - 1, Math.floor(p / (100 / BIN_COUNT)));
      bins[idx]++;
    }
    const xs: string[] = [];
    for (let i = 0; i < BIN_COUNT; i++) {
      const lo = i * 10;
      xs.push(`${lo}–${lo + 10}%`);
    }
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 50, right: 30, top: 30, bottom: 40 },
      xAxis: { type: "category", data: xs, axisLabel: { color: "#94a3b8", fontSize: 10 } },
      yAxis: { type: "value", axisLabel: { color: "#94a3b8" } },
      series: [
        {
          type: "bar",
          data: bins.map((v, i) => ({
            value: v,
            itemStyle: { color: colorFor(i * 10), borderRadius: [3, 3, 0, 0] },
          })),
          label: { show: true, position: "top", color: "#cbd5e1", fontSize: 10 },
        },
      ],
    };
  }, [records]);

  return <EChart option={option} height={height} />;
}
