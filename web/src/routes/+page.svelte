<script lang="ts">
  import Gamepad2 from "@lucide/svelte/icons/gamepad-2";
  import Users from "@lucide/svelte/icons/users";
  import Star from "@lucide/svelte/icons/star";
  import Wifi from "@lucide/svelte/icons/wifi";
  import WifiOff from "@lucide/svelte/icons/wifi-off";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TrendingUp from "@lucide/svelte/icons/trending-up";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { games, removedGames } from "$lib/games.svelte";
  import { computeKpis, countBy, topByPlayers } from "$lib/stats";
  import { i18n } from "$lib/i18n.svelte";
  import { formatNumber } from "$lib/utils";
  import { appidOf } from "$lib/data-store";
  import { headerToCapsule } from "$lib/image";
  import { CHART_PAGES } from "$lib/chart-nav";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import EChart from "$lib/charts/EChart.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import Seo from "$lib/common/Seo.svelte";

  const t = i18n.t;

  const records = $derived(games.data?.records ?? []);
  const kpis = $derived(computeKpis(records));
  const genres = $derived(countBy(records, (r) => r.genre).slice(0, 12));
  const top = $derived(topByPlayers(records, 8, (r) => r.type_game === "online"));

  // removedGames is a second, smaller file; the dashboard shows its count but
  // must not block on it.
  $effect(() => {
    if (records.length) void removedGames.load();
  });

  const genreOption = $derived.by(() => {
    const theme = chartTheme();
    return {
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value", axisLabel: { color: theme.mutedText }, splitLine: { lineStyle: { color: theme.grid } } },
      yAxis: {
        type: "category",
        inverse: true,
        data: genres.map((g) => g.name),
        axisLabel: { color: theme.mutedText },
        axisLine: { lineStyle: { color: theme.grid } },
      },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      series: [
        {
          type: "bar",
          data: genres.map((g) => g.value),
          itemStyle: { color: theme.series[0], borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 18,
        },
      ],
    };
  });
</script>

<Seo title={t("dashboard.title")} description={t("dashboard.subtitle", { count: kpis.total })} />

<PageHeader title={t("dashboard.title")} subtitle={t("dashboard.subtitle", { count: formatNumber(kpis.total) })} />

<QueryState loading={games.loading && !games.data} error={games.error} retry={() => games.refetch()}>
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {#each [
      { icon: Gamepad2, label: t("charts.kpi.totalGames"), value: formatNumber(kpis.total), hint: t("charts.kpi.totalGamesHint") },
      { icon: Users, label: t("charts.kpi.playersNow"), value: formatNumber(kpis.totalPlayers), hint: kpis.topPlayersGame },
      { icon: Star, label: t("charts.kpi.avgReview"), value: kpis.avgReview ? `${kpis.avgReview}%` : "—", hint: t("charts.kpi.avgReviewHint", { count: kpis.ratedCount }) },
      { icon: TrendingUp, label: t("charts.kpi.topGenre"), value: kpis.topGenre, hint: formatNumber(kpis.topGenreCount) },
    ] as k (k.label)}
      <div class="rounded-lg border bg-card p-4">
        <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <k.icon class="size-3.5" />
          {k.label}
        </div>
        <div class="mt-1.5 truncate font-display text-2xl font-semibold tnum">{k.value}</div>
        <div class="truncate text-xs text-muted-foreground">{k.hint}</div>
      </div>
    {/each}
  </div>

  <div class="mt-3 grid gap-3 sm:grid-cols-3">
    {#each [
      { icon: Wifi, label: t("charts.kpi.online"), value: kpis.online },
      { icon: WifiOff, label: t("charts.kpi.offline"), value: kpis.offline },
      { icon: Trash2, label: t("charts.kpi.removed"), value: removedGames.data?.length ?? 0 },
    ] as k (k.label)}
      <div class="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <k.icon class="size-4 shrink-0 text-muted-foreground" />
        <span class="text-sm text-muted-foreground">{k.label}</span>
        <span class="ml-auto font-semibold tnum">{formatNumber(k.value)}</span>
      </div>
    {/each}
  </div>

  <div class="mt-6 grid gap-4 lg:grid-cols-2">
    <section class="rounded-lg border bg-card p-5">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="text-base font-semibold">{t("dashboard.topGenres")}</h2>
        <a href="/charts/genres" class="text-xs text-primary hover:underline">
          {t("common.viewAll")}
        </a>
      </div>
      <EChart option={genreOption} height={320} label={t("dashboard.topGenres")} />
    </section>

    <section class="rounded-lg border bg-card p-5">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="text-base font-semibold">{t("dashboard.playingNow")}</h2>
        <a href="/top-online" class="text-xs text-primary hover:underline">
          {t("common.viewAll")}
        </a>
      </div>
      <ol class="space-y-1">
        {#each top as { record, players }, i (record.link)}
          {@const appid = appidOf(record)}
          <li>
            <a
              href={appid ? `/games/${appid}` : record.link}
              class="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
            >
              <span class="w-4 shrink-0 text-right text-xs text-muted-foreground tnum">{i + 1}</span>
              {#if record.header_image}
                <img
                  src={headerToCapsule(record.header_image)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="h-7 w-[60px] shrink-0 rounded object-cover"
                />
              {/if}
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{record.name}</span>
              <span class="shrink-0 text-sm text-muted-foreground tnum">{formatNumber(players)}</span>
            </a>
          </li>
        {/each}
      </ol>
    </section>
  </div>

  <section class="mt-6">
    <h2 class="mb-3 text-base font-semibold">{t("nav.charts")}</h2>
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {#each CHART_PAGES.slice(0, 6) as c (c.to)}
        <a
          href={c.to}
          class="group flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-border-strong hover:bg-accent"
        >
          <c.icon class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">{t(c.i18n)}</span>
            <span class="block truncate text-xs text-muted-foreground">{t(c.desc)}</span>
          </span>
          <ArrowRight
            class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </a>
      {/each}
    </div>
  </section>
</QueryState>
