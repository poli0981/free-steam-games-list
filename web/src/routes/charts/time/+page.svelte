<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme, gridBox } from "$lib/chart-theme";
  import ChartPage from "$lib/charts/ChartPage.svelte";
  import EChart from "$lib/charts/EChart.svelte";
  import { countByMonth, monthLabel, releaseYears, runningTotal } from "$lib/stats";

  const t = i18n.t;

  const records = $derived(games.data?.records ?? []);
  const years = $derived(releaseYears(records));

  const yearsOption = $derived.by(() => {
    const theme = chartTheme();
    return {
      grid: gridBox(),
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
          name: t("charts.time.releasesByYear"),
          data: years.map((y) => y.value),
          itemStyle: { color: theme.series[0], borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  });

  /* Growth. added_at is stamped when a game enters the catalogue, so this is
     the catalogue as it stands today, by the month each game joined - games
     removed since are not in it, which is why the running total can end below
     the number of games ever added. */
  const added = $derived(countByMonth(records.map((r) => r.added_at)));
  const total = $derived(runningTotal(added));

  const growthOption = $derived.by(() => {
    const theme = chartTheme();
    return {
      grid: gridBox({ top: 36 }),
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, textStyle: { color: theme.mutedText } },
      xAxis: {
        type: "category",
        data: added.map((a) => monthLabel(a.month, i18n.lang)),
        axisLabel: { color: theme.mutedText },
        axisLine: { lineStyle: { color: theme.grid } },
      },
      yAxis: [
        {
          type: "value",
          minInterval: 1,
          axisLabel: { color: theme.mutedText },
          splitLine: { lineStyle: { color: theme.grid } },
        },
        {
          type: "value",
          minInterval: 1,
          axisLabel: { color: theme.mutedText },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          type: "bar",
          name: t("charts.time.addedPerMonth"),
          data: added.map((a) => a.count),
          itemStyle: { color: theme.series[1], borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 48,
        },
        {
          type: "line",
          name: t("charts.time.catalogGrowth"),
          yAxisIndex: 1,
          data: total,
          smooth: true,
          symbolSize: 6,
          lineStyle: { color: theme.series[0], width: 2 },
          itemStyle: { color: theme.series[0] },
        },
      ],
    };
  });
</script>

<ChartPage title={t("nav.time")} subtitle={t("charts.desc.time")}>
  <div class="space-y-4">
    <section class="rounded-lg border bg-card p-4">
      <h2 class="mb-2 text-sm font-semibold">{t("charts.time.catalogGrowth")}</h2>
      <EChart option={growthOption} height={360} label={t("charts.time.catalogGrowth")} />
    </section>
    <section class="rounded-lg border bg-card p-4">
      <h2 class="mb-2 text-sm font-semibold">{t("charts.time.releasesByYear")}</h2>
      <EChart option={yearsOption} height={420} label={t("charts.time.releasesByYear")} />
    </section>
  </div>
</ChartPage>
