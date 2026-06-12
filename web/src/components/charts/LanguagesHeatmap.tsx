import { useMemo } from "react";
import { LazyEChart as EChart } from "./LazyEChart";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
  topLanguages?: number;
}

const SUPPORT = ["interface", "audio", "subtitles"] as const;
type Support = (typeof SUPPORT)[number];

export function LanguagesHeatmap({ records, height = 560, topLanguages = 30 }: Props) {
  const option = useMemo(() => {
    const counts = new Map<string, Record<Support, number>>();
    for (const r of records) {
      for (const ld of r.language_details ?? []) {
        if (!ld?.name) continue;
        const cur = counts.get(ld.name) ?? { interface: 0, audio: 0, subtitles: 0 };
        if (ld.interface) cur.interface++;
        if (ld.audio) cur.audio++;
        if (ld.subtitles) cur.subtitles++;
        counts.set(ld.name, cur);
      }
    }

    const langs = Array.from(counts.entries())
      .map(([name, c]) => ({ name, total: c.interface + c.audio + c.subtitles, c }))
      .sort((a, b) => b.total - a.total)
      .slice(0, topLanguages);

    const langNames = langs.map((l) => l.name);
    const data: [number, number, number][] = [];
    let max = 0;
    for (let y = 0; y < SUPPORT.length; y++) {
      for (let x = 0; x < langs.length; x++) {
        const v = langs[x].c[SUPPORT[y]];
        data.push([x, y, v]);
        if (v > max) max = v;
      }
    }

    return {
      tooltip: {
        formatter: (p: { value: [number, number, number] }) => {
          const [x, y, v] = p.value;
          return `<strong>${langNames[x]}</strong><br/>${SUPPORT[y]}: ${v} games`;
        },
      },
      grid: { left: 100, right: 30, top: 40, bottom: 90 },
      xAxis: {
        type: "category",
        data: langNames,
        axisLabel: { color: "#94a3b8", interval: 0, rotate: 45, fontSize: 10 },
      },
      yAxis: {
        type: "category",
        data: SUPPORT.map((s) => s.toUpperCase()),
        axisLabel: { color: "#94a3b8" },
      },
      visualMap: {
        min: 0,
        max,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 5,
        textStyle: { color: "#cbd5e1" },
        inRange: { color: ["#1e293b", "#3b82f6", "#a78bfa"] },
      },
      series: [
        {
          type: "heatmap",
          data,
          itemStyle: { borderColor: "#0f172a", borderWidth: 1 },
        },
      ],
    };
  }, [records, topLanguages]);

  return <EChart option={option} height={height} />;
}
