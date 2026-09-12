<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { chartTheme } from "$lib/chart-theme";
  import { computeKpis } from "$lib/stats";
  import { formatNumber, parseIntSafe, reviewLabel } from "$lib/utils";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import EChart from "$lib/charts/EChart.svelte";

  const t = i18n.t;
  const records = $derived(games.data?.records ?? []);
  const kpis = $derived(computeKpis(records));

  /* ── metacritic ────────────────────────────────────────────────────────
     A field no chart touched. Most F2P games are never reviewed by
     Metacritic at all, which is itself the finding. */
  const metacritic = $derived.by(() => {
    const bins = new Array(10).fill(0);
    let scored = 0;
    for (const r of records) {
      const n = parseIntSafe(r.metacritic);
      if (n <= 0 || n > 100) continue;
      bins[Math.min(9, Math.floor(n / 10))] += 1;
      scored += 1;
    }
    return { bins, scored };
  });

  const metacriticOption = $derived.by(() => {
    const theme = chartTheme();
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "category",
        data: metacritic.bins.map((_, i) => `${i * 10}-${i * 10 + 9}`),
        axisLabel: { color: theme.mutedText },
        axisLine: { lineStyle: { color: theme.grid } },
      },
      yAxis: { type: "value", axisLabel: { color: theme.mutedText }, splitLine: { lineStyle: { color: theme.grid } } },
      series: [
        {
          type: "bar",
          data: metacritic.bins,
          itemStyle: { color: theme.series[3], borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  });

  /* ── retention: peak today vs playing now ──────────────────────────────
     peak_today was never charted. A point far below the diagonal is a game
     whose concurrent count has already collapsed since its daily peak. */
  const retention = $derived.by(() =>
    records
      .map((r) => [parseIntSafe(r.peak_today), parseIntSafe(r.current_players)] as [number, number])
      .filter(([peak, now]) => peak > 0 && now > 0),
  );

  const retentionOption = $derived.by(() => {
    const theme = chartTheme();
    const max = Math.max(1, ...retention.map(([p]) => p));
    return {
      grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: { value: [number, number] }) =>
          `${t("detail.playersPeak")}: ${formatNumber(p.value[0])}<br>${t("detail.labelPlayers")}: ${formatNumber(p.value[1])}`,
      },
      // Log scales: the range runs from single digits to ~500,000, so a linear
      // axis puts every game except Counter-Strike in one corner.
      xAxis: {
        type: "log",
        name: t("detail.playersPeak"),
        nameTextStyle: { color: theme.mutedText },
        axisLabel: { color: theme.mutedText },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      yAxis: {
        type: "log",
        name: t("detail.labelPlayers"),
        nameTextStyle: { color: theme.mutedText },
        axisLabel: { color: theme.mutedText },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      series: [
        {
          type: "scatter",
          symbolSize: 5,
          data: retention,
          itemStyle: { color: theme.series[0], opacity: 0.45 },
          // large: canvas batching. ~1,300 points is enough to drop frames on
          // the per-point path.
          large: true,
          largeThreshold: 400,
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: theme.mutedText, type: "dashed", width: 1 },
            data: [[{ coord: [1, 1] }, { coord: [max, max] }]],
          },
        },
      ],
    };
  });

  /* ── safety flags ──────────────────────────────────────────────────────── */
  const safety = $derived.by(() => {
    const counts: Record<string, number> = { y: 0, n: 0, "?": 0, "": 0 };
    for (const r of records) counts[r.safe ?? ""] = (counts[r.safe ?? ""] ?? 0) + 1;
    return counts;
  });

  const safetyOption = $derived.by(() => {
    const theme = chartTheme();
    return {
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: { bottom: 0, textStyle: { color: theme.mutedText } },
      series: [
        {
          type: "pie",
          radius: ["50%", "74%"],
          itemStyle: { borderColor: theme.card, borderWidth: 2 },
          label: { show: false },
          data: [
            { name: t("common.yes"), value: safety.y, itemStyle: { color: "hsl(var(--success))" } },
            { name: t("common.no"), value: safety.n, itemStyle: { color: "hsl(var(--destructive))" } },
            { name: t("common.unknown"), value: safety["?"], itemStyle: { color: "hsl(var(--warning))" } },
            { name: t("common.none"), value: safety[""], itemStyle: { color: theme.grid } },
          ],
        },
      ],
    };
  });

  /* ── review wording ────────────────────────────────────────────────────
     reviewLabel() existed in lib/utils and nothing rendered it. Steam's own
     wording is a band, which reads differently from the raw percentage. */
  const labels = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      const label = reviewLabel(r.reviews);
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  });

  /* ── language coverage ─────────────────────────────────────────────────── */
  const langCoverage = $derived.by(() => {
    const buckets = [0, 0, 0, 0, 0];
    for (const r of records) {
      const n = (r.languages ?? []).length;
      if (n === 0) buckets[0] += 1;
      else if (n === 1) buckets[1] += 1;
      else if (n <= 5) buckets[2] += 1;
      else if (n <= 15) buckets[3] += 1;
      else buckets[4] += 1;
    }
    return buckets;
  });

  const langOption = $derived.by(() => {
    const theme = chartTheme();
    return {
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", axisLabel: { color: theme.mutedText }, splitLine: { lineStyle: { color: theme.grid } } },
      yAxis: {
        type: "category",
        inverse: true,
        data: ["0", "1", "2-5", "6-15", "16+"],
        axisLabel: { color: theme.mutedText },
        axisLine: { lineStyle: { color: theme.grid } },
      },
      series: [
        {
          type: "bar",
          data: langCoverage,
          itemStyle: { color: theme.series[5], borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 26,
        },
      ],
    };
  });
</script>

<svelte:head>
  <title>{t("stats.title")} · Steam F2P Tracker</title>
  <meta name="description" content={t("stats.subtitle")} />
</svelte:head>

<PageHeader title={t("stats.title")} subtitle={t("stats.subtitle")} />

<QueryState loading={games.loading && !games.data} error={games.error} retry={() => games.refetch()}>
  <div class="space-y-6">
    <section class="rounded-lg border bg-card p-5">
      <h2 class="text-base font-semibold">{t("stats.metacriticTitle")}</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {t("stats.metacriticDesc")}
        <span class="tnum">
          {t("games.showing", { shown: formatNumber(metacritic.scored), total: formatNumber(kpis.total) })}
        </span>
      </p>
      <EChart option={metacriticOption} height={320} label={t("stats.metacriticTitle")} class="mt-3" />
    </section>

    <section class="rounded-lg border bg-card p-5">
      <h2 class="text-base font-semibold">{t("stats.retentionTitle")}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{t("stats.retentionDesc")}</p>
      <EChart option={retentionOption} height={420} label={t("stats.retentionTitle")} class="mt-3" />
    </section>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="rounded-lg border bg-card p-5">
        <h2 class="text-base font-semibold">{t("stats.safetyTitle")}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{t("stats.safetyDesc")}</p>
        <EChart option={safetyOption} height={320} label={t("stats.safetyTitle")} class="mt-3" />
      </section>

      <section class="rounded-lg border bg-card p-5">
        <h2 class="text-base font-semibold">{t("stats.languageTitle")}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{t("stats.languageDesc")}</p>
        <EChart option={langOption} height={320} label={t("stats.languageTitle")} class="mt-3" />
      </section>
    </div>

    <section class="rounded-lg border bg-card p-5">
      <h2 class="text-base font-semibold">{t("stats.reviewLabelTitle")}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{t("stats.reviewLabelDesc")}</p>
      <ul class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {#each labels as [label, count] (label)}
          <li class="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm">
            <span class="truncate">{label}</span>
            <span class="shrink-0 text-muted-foreground tnum">{formatNumber(count)}</span>
          </li>
        {/each}
      </ul>
    </section>
  </div>
</QueryState>
