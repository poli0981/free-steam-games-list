<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import ChartPage from "$lib/charts/ChartPage.svelte";
  import EChart from "$lib/charts/EChart.svelte";

  const t = i18n.t;

  // A 2x2 of the two independent flags, which is the only way to see that
  // "has DRM" and "has paid DLC" mostly do not overlap.
  const buckets = $derived.by(() => {
    let clean = 0;
    let drmOnly = 0;
    let dlcOnly = 0;
    let both = 0;
    for (const r of games.data?.records ?? []) {
      const drm = Boolean(r.drm_notes && r.drm_notes !== "-");
      const dlc = Boolean(r.has_paid_dlc);
      if (drm && dlc) both += 1;
      else if (drm) drmOnly += 1;
      else if (dlc) dlcOnly += 1;
      else clean += 1;
    }
    return [clean, drmOnly, dlcOnly, both];
  });

  const LABELS = ["Clean F2P", "DRM only", "Paid DLC only", "DRM + paid DLC"];

  const option = $derived.by(() => {
    const theme = chartTheme();
    return {
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "value",
        axisLabel: { color: theme.mutedText },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: LABELS,
        axisLabel: { color: theme.mutedText },
        axisLine: { lineStyle: { color: theme.grid } },
      },
      series: [
        {
          type: "bar",
          data: buckets.map((value, i) => ({
            value,
            itemStyle: {
              color: i === 0 ? "hsl(var(--success))" : theme.series[i],
              borderRadius: [0, 4, 4, 0],
            },
          })),
          barMaxWidth: 34,
        },
      ],
    };
  });
</script>

<ChartPage title={t("nav.drmDlc")} subtitle={t("charts.desc.drm")}>
  <div class="rounded-lg border bg-card p-4">
    <EChart {option} height={360} label={t("nav.drmDlc")} />
  </div>
</ChartPage>
