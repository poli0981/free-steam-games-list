<script lang="ts">
  import { removedGames } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import { formatNumber } from "$lib/utils";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import EChart from "$lib/charts/EChart.svelte";

  const t = i18n.t;

  // This page reads removed_games.jsonl, NOT the catalogue - a delisted game
  // has left data/*.jsonl, so it is the one view that cannot be built from
  // `games`.
  $effect(() => {
    void removedGames.load();
  });

  const rows = $derived(removedGames.data ?? []);

  const KINDS = ["not_free", "unavailable", "other"] as const;
  type Kind = (typeof KINDS)[number];

  function kindOf(statusCode: string): Kind {
    return statusCode === "not_free" || statusCode === "unavailable"
      ? (statusCode as Kind)
      : "other";
  }

  const byReason = $derived.by(() => {
    const counts: Record<Kind, number> = { not_free: 0, unavailable: 0, other: 0 };
    for (const r of rows) counts[kindOf(r.status_code)] += 1;
    return counts;
  });

  const timeline = $derived.by(() => {
    const months = new Map<string, Record<Kind, number>>();
    for (const r of rows) {
      const month = (r.removed_at ?? "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      const bucket = months.get(month) ?? { not_free: 0, unavailable: 0, other: 0 };
      bucket[kindOf(r.status_code)] += 1;
      months.set(month, bucket);
    }
    const labels = [...months.keys()].sort();
    return { labels, buckets: labels.map((m) => months.get(m)!) };
  });

  const LABEL: Record<Kind, string> = {
    not_free: "charts.delisted.notFreeLabel",
    unavailable: "charts.delisted.unavailableLabel",
    other: "charts.delisted.otherLabel",
  };

  const reasonOption = $derived.by(() => {
    const theme = chartTheme();
    const COLOR: Record<Kind, string> = {
      not_free: "hsl(var(--warning))",
      unavailable: "hsl(var(--destructive))",
      other: theme.mutedText,
    };
    return {
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: { bottom: 0, textStyle: { color: theme.mutedText } },
      series: [
        {
          type: "pie",
          radius: ["50%", "75%"],
          itemStyle: { borderColor: theme.card, borderWidth: 2 },
          label: { show: false },
          data: KINDS.map((k) => ({
            name: t(LABEL[k]),
            value: byReason[k],
            itemStyle: { color: COLOR[k] },
          })),
        },
      ],
    };
  });

  const timelineOption = $derived.by(() => {
    const theme = chartTheme();
    const COLOR: Record<Kind, string> = {
      not_free: "hsl(var(--warning))",
      unavailable: "hsl(var(--destructive))",
      other: theme.mutedText,
    };
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 30, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { bottom: 0, textStyle: { color: theme.mutedText } },
      xAxis: {
        type: "category",
        data: timeline.labels,
        axisLabel: { color: theme.mutedText },
        axisLine: { lineStyle: { color: theme.grid } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: theme.mutedText },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      series: KINDS.map((k) => ({
        name: t(LABEL[k]),
        type: "bar",
        stack: "delisted",
        data: timeline.buckets.map((b) => b[k]),
        itemStyle: { color: COLOR[k] },
      })),
    };
  });
</script>

<svelte:head>
  <title>{t("nav.delisted")} · Steam F2P Tracker</title>
  <meta name="description" content={t("charts.desc.delisted")} />
</svelte:head>

<PageHeader title={t("nav.delisted")} subtitle={t("charts.desc.delisted")} />

<QueryState
  loading={removedGames.loading && !removedGames.data}
  error={removedGames.error}
  retry={() => removedGames.refetch()}
>
  <p class="mb-4 text-sm text-muted-foreground">
    <span class="font-semibold text-foreground tnum">{formatNumber(rows.length)}</span>
    {t("charts.kpi.removed")}
  </p>

  <div class="grid gap-4 lg:grid-cols-2">
    <section class="rounded-lg border bg-card p-4">
      <h2 class="mb-3 text-base font-semibold">{t("charts.delisted.reasonTitle")}</h2>
      <EChart option={reasonOption} height={360} label={t("charts.delisted.reasonTitle")} />
    </section>

    <section class="rounded-lg border bg-card p-4">
      <h2 class="mb-3 text-base font-semibold">{t("charts.delisted.timelineTitle")}</h2>
      <EChart option={timelineOption} height={360} label={t("charts.delisted.timelineTitle")} />
    </section>
  </div>
</QueryState>
