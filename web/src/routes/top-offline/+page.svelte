<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { topByPlayers } from "$lib/stats";
  import { appidOf } from "$lib/data-store";
  import { headerToCapsule } from "$lib/image";
  import { formatNumber, parseReviewPercent } from "$lib/utils";
  import { reviewTone } from "$lib/games/columns";
  import { chartTheme } from "$lib/chart-theme";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import EChart from "$lib/charts/EChart.svelte";
  import Badge from "$lib/ui/Badge.svelte";

  const t = i18n.t;

  const top = $derived(topByPlayers(games.data?.records ?? [], 100, (r) => r.type_game !== "online" && r.status === "active"));

  const option = $derived.by(() => {
    const theme = chartTheme();
    const rows = top.slice(0, 20);
    return {
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "value",
        axisLabel: { color: theme.mutedText },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map((r) => r.record.name),
        axisLabel: { color: theme.mutedText, width: 160, overflow: "truncate" },
        axisLine: { lineStyle: { color: theme.grid } },
      },
      series: [
        {
          type: "bar",
          data: rows.map((r) => r.players),
          itemStyle: { color: theme.series[0], borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 16,
        },
      ],
    };
  });
</script>

<svelte:head>
  <title>{t("nav.topOffline")} · Steam F2P Tracker</title>
  <meta name="description" content={t("topOffline.subtitle")} />
</svelte:head>

<PageHeader title={t("nav.topOffline")} subtitle={t("topOffline.subtitle")} />

<QueryState loading={games.loading && !games.data} error={games.error} retry={() => games.refetch()}>
  <div class="rounded-lg border bg-card p-4">
    <EChart {option} height={560} label={t("nav.topOffline")} />
  </div>

  <ol class="mt-4 divide-y rounded-lg border bg-card">
    {#each top as { record, players }, i (record.link)}
      {@const appid = appidOf(record)}
      {@const pct = parseReviewPercent(record.reviews)}
      <li>
        <a
          href={appid ? `/games/${appid}` : record.link}
          class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent"
        >
          <span class="w-6 shrink-0 text-right text-xs text-muted-foreground tnum">{i + 1}</span>
          {#if record.header_image}
            <img
              src={headerToCapsule(record.header_image)}
              alt=""
              loading="lazy"
              decoding="async"
              class="h-8 w-[68px] shrink-0 rounded object-cover"
            />
          {/if}
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{record.name}</span>
          {#if record.genre}<Badge variant="outline">{record.genre}</Badge>{/if}
          {#if pct !== null}
            <span class="hidden w-12 shrink-0 text-right font-mono text-xs tnum sm:inline {reviewTone(pct)}">
              {pct}%
            </span>
          {/if}
          <span class="w-20 shrink-0 text-right font-mono text-sm tnum">{formatNumber(players)}</span>
        </a>
      </li>
    {/each}
  </ol>
</QueryState>
