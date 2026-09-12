<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import ChartPage from "$lib/charts/ChartPage.svelte";
  import EChart from "$lib/charts/EChart.svelte";
  import { countBy } from "$lib/stats";
  import { SKIP_GENRE_TAGS } from "$lib/schema";

  const t = i18n.t;

  // 60 words, not the 100 the React version drew. Wordcloud layout is
  // canvas hit-testing per word and was the single biggest contributor to the
  // reported "[Violation] setTimeout handler took 122ms".
  const rows = $derived(
    countBy(games.data?.records ?? [], (r) => r.tags)
      // SKIP_GENRE_TAGS is a Set, not an array - these are the tags that
      // duplicate the genre field, so a cloud without this filter is mostly
      // just the genre chart again.
      .filter((t) => !SKIP_GENRE_TAGS.has(t.name))
      .slice(0, 60),
  );

  const option = $derived.by(() => {
    const theme = chartTheme();
    return {
      tooltip: { show: true },
      series: [
        {
          type: "wordCloud",
          shape: "circle",
          sizeRange: [12, 52],
          rotationRange: [0, 0],
          gridSize: 8,
          drawOutOfBound: false,
          textStyle: {
            // Deterministic, not Math.random(). The React version picked a
            // random colour per word on every render, so the same tag changed
            // colour on each repaint and the palette carried no meaning.
            color: (p: { dataIndex: number }) => theme.series[p.dataIndex % theme.series.length],
          },
          data: rows,
        },
      ],
    };
  });
</script>

<ChartPage title={t("nav.tags")} subtitle={t("charts.desc.tags")}>
  <div class="rounded-lg border bg-card p-4">
    <EChart {option} height={480} label={t("nav.tags")} />
  </div>

  <div class="mt-4 flex flex-wrap gap-1.5">
    {#each rows.slice(0, 40) as tag (tag.name)}
      <span class="rounded-md border bg-card px-2 py-1 text-xs">
        {tag.name}
        <span class="ml-1 text-muted-foreground tnum">{tag.value}</span>
      </span>
    {/each}
  </div>
</ChartPage>
