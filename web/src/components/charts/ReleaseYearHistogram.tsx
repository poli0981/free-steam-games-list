import { useMemo } from "react";
import { LazyEChart as EChart } from "./LazyEChart";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
}

const YEAR_RE = /(\d{4})/;

export function ReleaseYearHistogram({ records, height = 380 }: Props) {
  const option = useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of records) {
      const m = YEAR_RE.exec(r.release_date ?? "");
      if (!m) continue;
      const y = parseInt(m[1], 10);
      if (y < 1990 || y > 2100) continue;
      counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    const years = Array.from(counts.keys()).sort((a, b) => a - b);
    if (years.length === 0) {
      return { series: [] };
    }
    const min = years[0];
    const max = years[years.length - 1];
    const xs: string[] = [];
    const ys: number[] = [];
    for (let y = min; y <= max; y++) {
      xs.push(String(y));
      ys.push(counts.get(y) ?? 0);
    }
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 50, right: 30, top: 30, bottom: 50 },
      xAxis: {
        type: "category",
        data: xs,
        axisLabel: { color: "#94a3b8", rotate: 45, fontSize: 10 },
      },
      yAxis: { type: "value", axisLabel: { color: "#94a3b8" } },
      series: [
        {
          type: "bar",
          data: ys,
          itemStyle: { color: "#60a5fa", borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [records]);

  return <EChart option={option} height={height} />;
}
