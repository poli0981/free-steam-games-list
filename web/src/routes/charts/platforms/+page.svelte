<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import ChartPage from "$lib/charts/ChartPage.svelte";
  import EChart from "$lib/charts/EChart.svelte";
  import { countBy } from "$lib/stats";

  const t = i18n.t;

  const rows = $derived(countBy(games.data?.records ?? [], (r) => r.platforms));

  // Platform brand colours, NOT the accent ramp. A reader recognises these
  // faster than any label, and they are the same three everywhere the app
  // mentions a platform.
  const BRAND: Record<string, string> = {
    Windows: "hsl(207 90% 54%)",
    Mac: "hsl(258 70% 66%)",
    macOS: "hsl(258 70% 66%)",
    Linux: "hsl(36 92% 55%)",
    SteamOS: "hsl(152 56% 48%)",
  };

  const option = $derived.by(() => {
    const theme = chartTheme();
    return {
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: { bottom: 0, textStyle: { color: theme.mutedText } },
      series: [
        {
          type: "pie",
          radius: ["55%", "78%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: theme.card, borderWidth: 2 },
          label: { show: false },
          data: rows.map((r) => ({
            name: r.name,
            value: r.value,
            itemStyle: { color: BRAND[r.name] ?? theme.series[3] },
          })),
        },
      ],
    };
  });
</script>

<ChartPage title={t("nav.platforms")} subtitle={t("charts.desc.platforms")}>
  <div class="rounded-lg border bg-card p-4">
    <EChart {option} height={460} label={t("nav.platforms")} />
  </div>
</ChartPage>
