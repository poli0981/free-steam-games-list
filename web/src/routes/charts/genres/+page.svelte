<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { countBy } from "$lib/stats";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import { formatNumber } from "$lib/utils";
  import ChartPage from "$lib/charts/ChartPage.svelte";
  import EChart from "$lib/charts/EChart.svelte";

  const t = i18n.t;
  const genres = $derived(countBy(games.data?.records ?? [], (r) => r.genre));

  const option = $derived.by(() => {
    const theme = chartTheme();
    const total = genres.reduce((sum, g) => sum + g.value, 0) || 1;
    return {
      // A function, not "{b}: {c} ({d}%)": {d} is a pie/funnel template
      // variable, and a treemap leaves it in the tooltip as literal text.
      tooltip: {
        trigger: "item",
        formatter: (p: { name: string; value: number }) =>
          `${p.name}: ${formatNumber(p.value)} (${((p.value / total) * 100).toFixed(1)}%)`,
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          // The card colour, so the gaps between tiles read as the page
          // showing through rather than as a painted grid.
          itemStyle: { borderColor: theme.card, borderWidth: 2, gapWidth: 2 },
          label: { show: true, color: "#fff", fontSize: 12, overflow: "truncate" },
          colorSaturation: [0.35, 0.7],
          data: genres.map((g) => ({ name: g.name, value: g.value })),
        },
      ],
    };
  });
</script>

<ChartPage title={t("nav.genres")} subtitle={t("charts.desc.genres")}>
  <div class="rounded-lg border bg-card p-4">
    <EChart {option} height={520} label={t("nav.genres")} />
  </div>

  <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
    {#each genres.slice(0, 24) as g (g.name)}
      <div class="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm">
        <span class="truncate">{g.name}</span>
        <span class="shrink-0 text-muted-foreground tnum">{g.value}</span>
      </div>
    {/each}
  </div>
</ChartPage>
