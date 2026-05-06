import { useMemo } from "react";
import { EChart } from "./EChart";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
}

const PLATFORM_COLORS: Record<string, string> = {
  Windows: "#3b82f6",
  Mac: "#a78bfa",
  Linux: "#f59e0b",
  SteamOS: "#22c55e",
};

export function PlatformsDonut({ records, height = 360 }: Props) {
  const option = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      for (const p of r.platforms ?? []) {
        if (!p) continue;
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
    }
    const data = Array.from(counts.entries())
      .map(([name, value]) => ({
        name,
        value,
        itemStyle: { color: PLATFORM_COLORS[name] ?? "#64748b" },
      }))
      .sort((a, b) => b.value - a.value);

    return {
      tooltip: {
        trigger: "item",
        formatter: "<strong>{b}</strong><br/>{c} games ({d}%)",
      },
      legend: {
        bottom: 0,
        textStyle: { color: "#cbd5e1" },
      },
      series: [
        {
          type: "pie",
          radius: ["55%", "78%"],
          center: ["50%", "45%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: "#0f172a",
            borderWidth: 2,
          },
          label: { show: false },
          data,
        },
      ],
    };
  }, [records]);

  return <EChart option={option} height={height} />;
}
