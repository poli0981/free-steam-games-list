import { useMemo } from "react";
import { EChart } from "./EChart";
import type { RemovedGame } from "../../hooks/useRemovedGames";

interface Props {
  records: RemovedGame[];
  height?: number;
}

const COLORS: Record<string, string> = {
  not_free: "#f59e0b",
  unavailable: "#f43f5e",
};

export function DelistedReasonBreakdown({ records, height = 360 }: Props) {
  const option = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      const k = r.status_code || "unknown";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const data = [...counts.entries()].map(([name, value]) => ({
      name,
      value,
      itemStyle: { color: COLORS[name] ?? "#94a3b8" },
    }));

    return {
      tooltip: {
        trigger: "item",
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}<br/>${p.value} (${p.percent.toFixed(1)}%)`,
      },
      legend: { bottom: 0, textStyle: { color: "#cbd5e1" } },
      series: [
        {
          type: "pie",
          radius: ["45%", "70%"],
          center: ["50%", "45%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#0f172a", borderWidth: 2 },
          label: {
            show: true,
            color: "#cbd5e1",
            formatter: "{b}: {c}",
          },
          data,
        },
      ],
    };
  }, [records]);

  return <EChart option={option} height={height} />;
}
