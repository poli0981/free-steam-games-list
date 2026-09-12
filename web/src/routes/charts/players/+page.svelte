<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import ChartPage from "$lib/charts/ChartPage.svelte";
  import EChart from "$lib/charts/EChart.svelte";
  import { parseIntSafe } from "$lib/utils";

  const t = i18n.t;

  const TIERS = [
    { label: "100k+", min: 100_000 },
    { label: "10k+", min: 10_000 },
    { label: "1k+", min: 1_000 },
    { label: "1-1k", min: 1 },
    { label: "0", min: 0 },
  ];

  const tiers = $derived.by(() => {
    const counts = TIERS.map(() => 0);
    for (const r of games.data?.records ?? []) {
      if (r.type_game !== "online") continue;
      const n = parseIntSafe(r.current_players);
      const i = TIERS.findIndex((t) => n >= t.min);
      counts[i === -1 ? TIERS.length - 1 : i] += 1;
    }
    return counts;
  });

  const option = $derived.by(() => {
    const theme = chartTheme();
    return {
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: { bottom: 0, textStyle: { color: theme.mutedText } },
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          itemStyle: { borderColor: theme.card, borderWidth: 2 },
          label: { show: false },
          data: TIERS.map((t, i) => ({ name: t.label, value: tiers[i] })),
        },
      ],
    };
  });
</script>

<ChartPage title={t("nav.players")} subtitle={t("charts.desc.players")}>
  <div class="rounded-lg border bg-card p-4">
    <EChart {option} height={440} label={t("nav.players")} />
  </div>
</ChartPage>
