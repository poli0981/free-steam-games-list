import { useMemo } from "react";
import { LazyEChart as EChart } from "./LazyEChart";
import { parseIntSafe } from "../../lib/utils";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  limit?: number;
  height?: number;
}

function tierColor(players: number): string {
  if (players >= 100_000) return "#f43f5e";
  if (players >= 10_000) return "#f59e0b";
  if (players >= 1_000) return "#22c55e";
  return "#60a5fa";
}

export function TopOnlineBar({ records, limit = 30, height = 600 }: Props) {
  const option = useMemo(() => {
    const ranked = records
      .filter((r) => r.type_game === "online")
      .map((r) => ({
        name: r.name || "—",
        value: parseIntSafe(r.current_players),
      }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .reverse();

    return {
      grid: { left: 180, right: 40, top: 20, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v: number) => v.toLocaleString(),
      },
      xAxis: {
        type: "value",
        axisLabel: { color: "#94a3b8", formatter: (v: number) => v.toLocaleString() },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.15)" } },
      },
      yAxis: {
        type: "category",
        data: ranked.map((r) => r.name),
        axisLabel: {
          color: "#94a3b8",
          formatter: (v: string) => (v.length > 28 ? v.slice(0, 28) + "…" : v),
        },
      },
      series: [
        {
          type: "bar",
          data: ranked.map((r) => ({
            value: r.value,
            itemStyle: { color: tierColor(r.value), borderRadius: [0, 4, 4, 0] },
          })),
          label: {
            show: true,
            position: "right",
            color: "#cbd5e1",
            formatter: (p: { value: number }) => p.value.toLocaleString(),
          },
        },
      ],
    };
  }, [records, limit]);

  return <EChart option={option} height={height} />;
}
