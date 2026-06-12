import { useMemo } from "react";
import { LazyEChart as EChart } from "./LazyEChart";
import { parseIntSafe } from "../../lib/utils";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
}

const TIERS = [
  { label: "100k+", min: 100_000, color: "#f43f5e" },
  { label: "10k+", min: 10_000, color: "#f59e0b" },
  { label: "1k+", min: 1_000, color: "#22c55e" },
  { label: "1-1k", min: 1, color: "#60a5fa" },
  { label: "0", min: 0, color: "#475569" },
];

export function PlayerTiersPie({ records, height = 380 }: Props) {
  const option = useMemo(() => {
    const counts = new Array(TIERS.length).fill(0);
    for (const r of records) {
      if (r.type_game !== "online") continue;
      const cp = parseIntSafe(r.current_players);
      for (let i = 0; i < TIERS.length; i++) {
        if (cp >= TIERS[i].min) {
          counts[i]++;
          break;
        }
      }
    }
    const data = TIERS.map((t, i) => ({
      name: t.label,
      value: counts[i],
      itemStyle: { color: t.color },
    })).filter((d) => d.value > 0);

    return {
      tooltip: {
        trigger: "item",
        formatter: "<strong>{b}</strong><br/>{c} online games ({d}%)",
      },
      legend: { bottom: 0, textStyle: { color: "#cbd5e1" } },
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          center: ["50%", "44%"],
          data,
          itemStyle: { borderRadius: 6, borderColor: "#0f172a", borderWidth: 2 },
          label: { show: false },
        },
      ],
    };
  }, [records]);

  return <EChart option={option} height={height} />;
}
