<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import ChartPage from "$lib/charts/ChartPage.svelte";
  import EChart from "$lib/charts/EChart.svelte";

  const t = i18n.t;

  const AXES = ["interface", "audio", "subtitles"] as const;

  // Top 30 languages by interface support, then a language x support-kind
  // matrix. The long tail is dozens of languages with a handful of games each,
  // which turns the heatmap into noise.
  const matrix = $derived.by(() => {
    const totals = new Map<string, number>();
    const cells = new Map<string, number[]>();

    for (const r of games.data?.records ?? []) {
      for (const d of r.language_details ?? []) {
        const name = d.name?.trim();
        if (!name) continue;
        const row = cells.get(name) ?? [0, 0, 0];
        if (d.interface) row[0] += 1;
        if (d.audio) row[1] += 1;
        if (d.subtitles) row[2] += 1;
        cells.set(name, row);
        totals.set(name, Math.max(totals.get(name) ?? 0, row[0]));
      }
    }

    const languages = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name]) => name);

    const data: [number, number, number][] = [];
    languages.forEach((lang, y) => {
      const row = cells.get(lang) ?? [0, 0, 0];
      AXES.forEach((_, x) => data.push([x, y, row[x]]));
    });

    return { languages, data, max: Math.max(1, ...data.map((d) => d[2])) };
  });

  const option = $derived.by(() => {
    const theme = chartTheme();
    return {
      grid: { left: 8, right: 8, top: 30, bottom: 60, containLabel: true },
      tooltip: { position: "top" },
      xAxis: {
        type: "category",
        data: AXES.map((a) => t(`detail.label${a[0].toUpperCase()}${a.slice(1)}`) || a),
        position: "top",
        axisLabel: { color: theme.mutedText },
        splitArea: { show: true },
      },
      yAxis: {
        type: "category",
        data: matrix.languages,
        axisLabel: { color: theme.mutedText, fontSize: 11 },
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: matrix.max,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 8,
        textStyle: { color: theme.mutedText },
        // Card -> accent, so an empty cell reads as "nothing here" rather than
        // as a dark colour that means something.
        inRange: { color: [theme.card, theme.series[0]] },
      },
      series: [
        {
          type: "heatmap",
          data: matrix.data,
          label: { show: false },
          itemStyle: { borderColor: theme.card, borderWidth: 1 },
        },
      ],
    };
  });
</script>

<ChartPage title={t("nav.languages")} subtitle={t("charts.desc.languages")}>
  <div class="rounded-lg border bg-card p-4">
    <EChart {option} height={720} label={t("nav.languages")} />
  </div>
</ChartPage>
