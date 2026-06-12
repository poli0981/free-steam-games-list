import { useMemo } from "react";
import { LazyEChart as EChart } from "./LazyEChart";
import type { GameRecord } from "../../lib/schema";

interface Props {
  records: GameRecord[];
  height?: number;
}

interface Counts {
  cleanFree: number;
  drmOnly: number;
  paidDlcOnly: number;
  drmAndPaidDlc: number;
}

export function DrmDlcBars({ records, height = 380 }: Props) {
  const option = useMemo(() => {
    const c: Counts = { cleanFree: 0, drmOnly: 0, paidDlcOnly: 0, drmAndPaidDlc: 0 };
    for (const r of records) {
      const hasDrm = !!r.drm_notes && r.drm_notes !== "None detected" && r.drm_notes !== "-";
      const hasPaidDlc = !!r.has_paid_dlc;
      if (hasDrm && hasPaidDlc) c.drmAndPaidDlc++;
      else if (hasDrm) c.drmOnly++;
      else if (hasPaidDlc) c.paidDlcOnly++;
      else c.cleanFree++;
    }
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 50, right: 30, top: 30, bottom: 60 },
      xAxis: {
        type: "category",
        data: ["Clean F2P", "DRM only", "Paid DLC only", "DRM + Paid DLC"],
        axisLabel: { color: "#94a3b8", interval: 0, fontSize: 11 },
      },
      yAxis: { type: "value", axisLabel: { color: "#94a3b8" } },
      series: [
        {
          type: "bar",
          data: [
            { value: c.cleanFree, itemStyle: { color: "#22c55e" } },
            { value: c.drmOnly, itemStyle: { color: "#f59e0b" } },
            { value: c.paidDlcOnly, itemStyle: { color: "#a78bfa" } },
            { value: c.drmAndPaidDlc, itemStyle: { color: "#f43f5e" } },
          ],
          label: { show: true, position: "top", color: "#cbd5e1" },
          barWidth: "50%",
        },
      ],
    };
  }, [records]);

  return <EChart option={option} height={height} />;
}
