<script lang="ts">
  import Building2 from "@lucide/svelte/icons/building-2";
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { countBy } from "$lib/stats";
  import { formatNumber } from "$lib/utils";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import Input from "$lib/ui/Input.svelte";

  const t = i18n.t;

  // developer[] and publisher[] are on every record and were used by nothing
  // before this page: no chart, no filter, no link.
  const studios = $derived(countBy(games.data?.records ?? [], (r) => r.developer));

  let q = $state("");
  const shown = $derived(
    q.trim() ? studios.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())) : studios,
  );
</script>

<svelte:head>
  <title>{t("studios.developersTitle")} · Steam F2P Tracker</title>
  <meta name="description" content={t("studios.developersSubtitle", { count: studios.length })} />
</svelte:head>

<PageHeader
  title={t("studios.developersTitle")}
  subtitle={t("studios.developersSubtitle", { count: formatNumber(studios.length) })}
/>

<QueryState loading={games.loading && !games.data} error={games.error} retry={() => games.refetch()}>
  <div class="mb-3 max-w-sm">
    <Input bind:value={q} type="search" placeholder={t("common.search")} aria-label={t("common.search")} />
  </div>

  <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
    {#each shown.slice(0, 300) as s (s.name)}
      <a
        href={`/developers/${encodeURIComponent(s.name)}`}
        class="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors
               hover:border-border-strong hover:bg-accent"
      >
        <Building2 class="size-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
        <span class="shrink-0 text-xs text-muted-foreground tnum">{s.value}</span>
      </a>
    {/each}
  </div>

  {#if shown.length > 300}
    <p class="mt-3 text-xs text-muted-foreground">
      {t("games.showing", { shown: 300, total: formatNumber(shown.length) })}
    </p>
  {/if}
  {#if !shown.length}
    <p class="py-16 text-center text-sm text-muted-foreground">{t("studios.notFound")}</p>
  {/if}
</QueryState>
