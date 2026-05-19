import { useMemo } from "react";
import { EChart } from "./EChart";
import type { RemovedGame } from "../../hooks/useRemovedGames";

interface Props {
  records: RemovedGame[];
  height?: number;
}

export function DelistedTimeline({ records, height = 400 }: Props) {
  const option = useMemo(() => {
    // Bucket by YYYY-MM, split by status_code so users can see both
    // "no longer free" and "delisted from Steam" trends side-by-side.
    const buckets = new Map<string, { not_free: number; unavailable: number; other: number }>();
    for (const r of records) {
      const t = r.removed_at ?? "";
      if (t.length < 7) continue;
      const month = t.slice(0, 7);
      const entry = buckets.get(month) ?? { not_free: 0, unavailable: 0, other: 0 };
      if (r.status_code === "not_free") entry.not_free += 1;
      else if (r.status_code === "unavailable") entry.unavailable += 1;
      else entry.other += 1;
      buckets.set(month, entry);
    }
    const labels = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
    const notFree = labels.map((l) => buckets.get(l)!.not_free);
    const unavailable = labels.map((l) => buckets.get(l)!.unavailable);
    const other = labels.map((l) => buckets.get(l)!.other);
    const showOther = other.some((v) => v > 0);

    return {
      grid: { left: 48, right: 24, top: 36, bottom: 56 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, textStyle: { color: "#cbd5e1" } },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: "#94a3b8", rotate: 45, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#94a3b8" },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.15)" } },
      },
      series: [
        {
          name: "No longer free",
          type: "bar",
          stack: "delisted",
          data: notFree,
          itemStyle: { color: "#f59e0b" },
        },
        {
          name: "Unavailable",
          type: "bar",
          stack: "delisted",
          data: unavailable,
          itemStyle: { color: "#f43f5e" },
        },
        ...(showOther
          ? [
              {
                name: "Other",
                type: "bar",
                stack: "delisted",
                data: other,
                itemStyle: { color: "#94a3b8" },
              },
            ]
          : []),
      ],
    };
  }, [records]);

  return <EChart option={option} height={height} />;
}
