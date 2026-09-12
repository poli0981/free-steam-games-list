<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import ChartPage from "$lib/charts/ChartPage.svelte";
  import EChart from "$lib/charts/EChart.svelte";
  import { parseReviewPercent } from "$lib/utils";

  const t = i18n.t;

  // Ten 10% bins. The raw percentages are far too granular to read as a
  // distribution, and Steam's own label is a band anyway.
  const bins = $derived.by(() => {
    const counts = new Array(10).fill(0);
    for (const r of games.data?.records ?? []) {
      const pct = parseReviewPercent(r.reviews);
      if (pct === null) continue;
      counts[Math.min(9, Math.floor(pct / 10))] += 1;
    }
    return counts;
  });

  const option = $derived.by(() => {
    const theme = chartTheme();
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "category",
        data: bins.map((_, i) => `${i * 10}-${i * 10 + 9}%`),
        axisLabel: { color: theme.mutedText },
        axisLine: { lineStyle: { color: theme.grid } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: theme.mutedText },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      series: [
        {
          type: "bar",
          data: bins.map((value, i) => ({
            value,
            // Meaning-bearing: the same three tones the table uses for a
            // review score, so a reader who learned them there reads this
            // without a legend.
            itemStyle: {
              color:
                i >= 8
                  ? "hsl(var(--success))"
                  : i >= 7
                    ? "hsl(var(--warning))"
                    : "hsl(var(--destructive))",
              borderRadius: [4, 4, 0, 0],
            },
          })),
        },
      ],
    };
  });
</script>

<ChartPage title={t("nav.reviews")} subtitle={t("charts.desc.reviews")}>
  <div class="rounded-lg border bg-card p-4">
    <EChart {option} height={420} label={t("nav.reviews")} />
  </div>
</ChartPage>
