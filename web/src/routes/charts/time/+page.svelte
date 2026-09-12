<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import ChartPage from "$lib/charts/ChartPage.svelte";
  import EChart from "$lib/charts/EChart.svelte";
  import { releaseYears } from "$lib/stats";

  const t = i18n.t;

  const years = $derived(releaseYears(games.data?.records ?? []));

  const option = $derived.by(() => {
    const theme = chartTheme();
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "category",
        data: years.map((y) => y.name),
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
          data: years.map((y) => y.value),
          itemStyle: { color: theme.series[0], borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  });
</script>

<ChartPage title={t("nav.time")} subtitle={t("charts.desc.time")}>
  <div class="rounded-lg border bg-card p-4">
    <EChart {option} height={420} label={t("nav.time")} />
  </div>
</ChartPage>
