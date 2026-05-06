import { useMemo } from "react";
import { EChart } from "./EChart";
import type { GameRecord } from "../../lib/schema";
import { SKIP_GENRE_TAGS } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
  limit?: number;
}

const COLORS = ["#60a5fa", "#a78bfa", "#22c55e", "#f59e0b", "#f43f5e", "#ec4899", "#06b6d4"];

export function TagsWordCloud({ records, height = 520, limit = 100 }: Props) {
  const option = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      for (const t of r.tags ?? []) {
        if (!t || SKIP_GENRE_TAGS.has(t)) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const data = Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);

    return {
      tooltip: {
        formatter: (p: { name: string; value: number }) =>
          `<strong>${p.name}</strong><br/>${p.value} games`,
      },
      series: [
        {
          type: "wordCloud",
          gridSize: 6,
          sizeRange: [12, 56],
          rotationRange: [-30, 30],
          rotationStep: 15,
          shape: "circle",
          width: "100%",
          height: "100%",
          drawOutOfBound: false,
          textStyle: {
            color: () => COLORS[Math.floor(Math.random() * COLORS.length)],
            fontWeight: 600,
          },
          emphasis: {
            textStyle: { color: "#fff", fontWeight: 800 },
          },
          data,
        },
      ],
    };
  }, [records, limit]);

  return <EChart option={option} height={height} />;
}
