import { useMemo } from "react";
import { LazyEChart as EChart } from "./LazyEChart";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
}

export function GenreTreemap({ records, height = 480 }: Props) {
  const option = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      const g = r.genre?.trim() || "Uncategorized";
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const data = Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return {
      tooltip: {
        formatter: (p: { name: string; value: number; percent?: number }) =>
          `<strong>${p.name}</strong><br/>${p.value} games`,
      },
      series: [
        {
          type: "treemap",
          data,
          roam: false,
          breadcrumb: { show: false },
          nodeClick: false,
          label: {
            show: true,
            formatter: "{b}\n{c}",
            color: "#fff",
            fontSize: 12,
          },
          upperLabel: { show: false },
          itemStyle: { borderColor: "#0f172a", borderWidth: 2, gapWidth: 2 },
          levels: [
            {
              itemStyle: {
                borderColor: "#0f172a",
                borderWidth: 2,
                gapWidth: 2,
              },
              colorSaturation: [0.35, 0.7],
            },
          ],
        },
      ],
    };
  }, [records]);

  return <EChart option={option} height={height} />;
}
