import { useMemo } from "react";
import { LazyEChart as EChart } from "./LazyEChart";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
  topGenres?: number;
}

type Bucket = "kernel" | "userMode" | "none";

function bucket(g: GameRecord): Bucket {
  if (g.is_kernel_ac === true) return "kernel";
  if (g.anti_cheat && g.anti_cheat !== "-") return "userMode";
  return "none";
}

export function AntiCheatStacked({ records, height = 520, topGenres = 18 }: Props) {
  const option = useMemo(() => {
    const byGenre = new Map<string, { kernel: number; userMode: number; none: number }>();
    for (const r of records) {
      const g = r.genre || "Uncategorized";
      const b = byGenre.get(g) ?? { kernel: 0, userMode: 0, none: 0 };
      b[bucket(r)]++;
      byGenre.set(g, b);
    }
    const ranked = Array.from(byGenre.entries())
      .sort((a, b) => {
        const aT = a[1].kernel + a[1].userMode + a[1].none;
        const bT = b[1].kernel + b[1].userMode + b[1].none;
        return bT - aT;
      })
      .slice(0, topGenres);

    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: {
        data: ["Kernel-level", "User-mode", "None"],
        textStyle: { color: "#cbd5e1" },
      },
      grid: { left: 100, right: 30, top: 40, bottom: 40 },
      xAxis: { type: "value", axisLabel: { color: "#94a3b8" } },
      yAxis: {
        type: "category",
        data: ranked.map((r) => r[0]),
        axisLabel: { color: "#94a3b8" },
      },
      series: [
        {
          name: "Kernel-level",
          type: "bar",
          stack: "ac",
          itemStyle: { color: "#f43f5e" },
          data: ranked.map((r) => r[1].kernel),
        },
        {
          name: "User-mode",
          type: "bar",
          stack: "ac",
          itemStyle: { color: "#f59e0b" },
          data: ranked.map((r) => r[1].userMode),
        },
        {
          name: "None",
          type: "bar",
          stack: "ac",
          itemStyle: { color: "#22c55e" },
          data: ranked.map((r) => r[1].none),
        },
      ],
    };
  }, [records, topGenres]);

  return <EChart option={option} height={height} />;
}
