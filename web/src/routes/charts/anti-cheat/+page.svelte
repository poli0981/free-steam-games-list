<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import { acLevel, type AcLevel } from "$lib/anti-cheat";
  import { countBy } from "$lib/stats";
  import ChartPage from "$lib/charts/ChartPage.svelte";
  import EChart from "$lib/charts/EChart.svelte";

  const t = i18n.t;

  // Stacked by genre, because "which genres demand kernel access" is the
  // question this field is actually interesting for.
  const LEVELS: AcLevel[] = ["kernel", "user", "unknown", "none"];

  const stacked = $derived.by(() => {
    const records = games.data?.records ?? [];
    const topGenres = countBy(records, (r) => r.genre).slice(0, 18).map((g) => g.name);
    const index = new Map(topGenres.map((g, i) => [g, i]));

    const series: Record<AcLevel, number[]> = {
      kernel: new Array(topGenres.length).fill(0),
      user: new Array(topGenres.length).fill(0),
      unknown: new Array(topGenres.length).fill(0),
      none: new Array(topGenres.length).fill(0),
    };

    for (const r of records) {
      const i = r.genre ? index.get(r.genre) : undefined;
      if (i === undefined) continue;
      series[acLevel(r)][i] += 1;
    }
    return { genres: topGenres, series };
  });

  const option = $derived.by(() => {
    const theme = chartTheme();
    // Kernel is the one that matters, so it gets the destructive token; the
    // rest descend in prominence. "unknown" is deliberately NOT folded into
    // "none" - is_kernel_ac is tri-state and null means nobody checked.
    const COLOR: Record<AcLevel, string> = {
      kernel: "hsl(var(--destructive))",
      user: "hsl(var(--warning))",
      unknown: theme.mutedText,
      none: theme.grid,
    };
    return {
      grid: { left: 8, right: 16, top: 8, bottom: 30, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { bottom: 0, textStyle: { color: theme.mutedText } },
      xAxis: {
        type: "value",
        axisLabel: { color: theme.mutedText },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: stacked.genres,
        axisLabel: { color: theme.mutedText },
        axisLine: { lineStyle: { color: theme.grid } },
      },
      series: LEVELS.map((level) => ({
        name: t(`charts.acLevel.${level}`),
        type: "bar",
        stack: "ac",
        data: stacked.series[level],
        itemStyle: { color: COLOR[level] },
      })),
    };
  });
</script>

<ChartPage title={t("nav.antiCheat")} subtitle={t("charts.desc.antiCheat")}>
  <div class="rounded-lg border bg-card p-4">
    <EChart {option} height={560} label={t("nav.antiCheat")} />
  </div>
  <p class="mt-3 text-sm text-muted-foreground">
    {t("charts.acLevel.note")}
    <a href="/charts/anti-cheat/list" class="text-primary hover:underline">
      {t("nav.antiCheatList")}
    </a>
  </p>
</ChartPage>
