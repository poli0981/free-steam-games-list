<script lang="ts">
  import { onMount, untrack } from "svelte";
  import X from "@lucide/svelte/icons/x";
  import Download from "@lucide/svelte/icons/download";
  import { page as appPage } from "$app/state";
  import { replaceState } from "$app/navigation";
  import { games } from "$lib/games.svelte";
  import { filters, FILTER_PARAMS, PAGE_SIZES } from "$lib/filters.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { buildSearchIndex, applyFilters, applySort, facets } from "$lib/games/filtering";
  import { formatNumber } from "$lib/utils";
  import { exportCsv, exportJson } from "$lib/export";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import GamesTable from "$lib/games/GamesTable.svelte";
  import MobileGameCards from "$lib/games/MobileGameCards.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Seo from "$lib/common/Seo.svelte";

  const t = i18n.t;

  const records = $derived(games.data?.records ?? []);

  // Rebuilt only when the record set changes, not per keystroke: indexing
  // 3,700 records on every character is the difference between instant and
  // visibly laggy.
  const fuse = $derived(buildSearchIndex(records));
  const facet = $derived(facets(records));

  const filtered = $derived(
    applyFilters(records, fuse, {
      search: filters.search,
      genre: filters.genre,
      typeGame: filters.typeGame,
      platform: filters.platform,
      safe: filters.safe,
      status: filters.status,
      hasAntiCheat: filters.hasAntiCheat,
      hideDead: filters.hideDead,
    }),
  );

  const sorted = $derived(applySort(filtered, filters.sortKey, filters.sortDir));

  // -1 means "all", which the virtualiser handles fine because it only ever
  // renders what is on screen.
  const pageCount = $derived(
    filters.pageSize === -1 ? 1 : Math.max(1, Math.ceil(sorted.length / filters.pageSize)),
  );

  /* ── the URL ─────────────────────────────────────────────────────────────
     Filters, sort and page are mirrored into the query string, so a filtered
     view can be linked (/health links its groups here) and survives a reload.

     Browser-only, on purpose. This page is prerendered, and reading
     url.search during prerender throws; the static HTML is the unfiltered
     page, and the query string is applied once mounted. A link WITH filter
     parameters replaces the stored filters; a plain /games keeps whatever the
     reader had, and writes it back into the address bar. */
  let urlReady = false;

  onMount(() => {
    const params = new URLSearchParams(location.search);
    if ([...params.keys()].some((k) => FILTER_PARAMS.has(k))) filters.fromQuery(params);
    urlReady = true;
  });

  $effect(() => {
    const query = filters.toQuery().toString();
    if (!urlReady) return;
    // Debounced: typing in the search box would otherwise rewrite history
    // state on every keystroke.
    const timer = setTimeout(() => {
      const next = location.pathname + (query ? `?${query}` : "") + location.hash;
      if (next !== location.pathname + location.search + location.hash) {
        replaceState(next, appPage.state);
      }
    }, 250);
    return () => clearTimeout(timer);
  });

  /* ── the page number ─────────────────────────────────────────────────────
     Kept in the filter store, so opening a game and coming Back returns to
     the same page. Different criteria start again at the first page. */
  $effect(() => {
    const signature = filters.signature;
    untrack(() => {
      if (signature === filters.pageFor) return;
      if (filters.pageFor !== "") filters.page = 0;
      filters.pageFor = signature;
    });
  });

  // Past the end of a shorter result set - but only once there ARE results to
  // measure: while the catalogue loads, every page is "past the end", and
  // clamping then threw away a linked or remembered page.
  $effect(() => {
    if (!games.data) return;
    const count = pageCount;
    untrack(() => {
      if (filters.page >= count) filters.page = 0;
    });
  });

  const visible = $derived(
    filters.pageSize === -1
      ? sorted
      : sorted.slice(filters.page * filters.pageSize, (filters.page + 1) * filters.pageSize),
  );

  function exportAs(kind: "csv" | "json") {
    // Exports the FILTERED set, not the page: someone who filtered to 40 games
    // and exported would otherwise get whichever 40 the pager happened to show.
    if (kind === "csv") exportCsv(sorted);
    else exportJson(sorted);
  }
</script>

<Seo title={t("games.title")} description={t("games.subtitle")} />

<PageHeader title={t("games.title")} subtitle={t("games.subtitle")}>
  {#snippet actions()}
    <Button variant="outline" size="sm" onclick={() => exportAs("csv")}>
      <Download class="size-4" /> CSV
    </Button>
    <Button variant="outline" size="sm" onclick={() => exportAs("json")}>
      <Download class="size-4" /> JSON
    </Button>
  {/snippet}
</PageHeader>

<QueryState loading={games.pending} error={games.error} retry={() => games.refetch()}>
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <select
      bind:value={filters.genre}
      aria-label={t("games.filterAllGenres")}
      class="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value={null}>{t("games.filterAllGenres")}</option>
      {#each facet.genre as [name, count] (name)}
        <option value={name}>{name} ({count})</option>
      {/each}
    </select>

    <select
      bind:value={filters.typeGame}
      aria-label={t("games.filterAllTypes")}
      class="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value={null}>{t("games.filterAllTypes")}</option>
      <option value="online">{t("common.online")}</option>
      <option value="offline">{t("common.offline")}</option>
    </select>

    <select
      bind:value={filters.platform}
      aria-label={t("games.filterAllPlatforms")}
      class="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value={null}>{t("games.filterAllPlatforms")}</option>
      {#each facet.platform as [name, count] (name)}
        <option value={name}>{name} ({count})</option>
      {/each}
    </select>

    <select
      bind:value={filters.status}
      aria-label={t("games.filterAllStatus")}
      class="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value={null}>{t("games.filterAllStatus")}</option>
      <option value="active">{t("common.active")}</option>
      <option value="delisted">{t("common.delisted")}</option>
    </select>

    <select
      bind:value={filters.safe}
      aria-label={t("games.filterAllSafe")}
      class="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value={null}>{t("games.filterAllSafe")}</option>
      <option value="y">{t("games.safeYes")}</option>
      <option value="n">{t("games.safeNo")}</option>
      <option value="?">{t("games.safeUnreviewed")}</option>
      <option value="">{t("games.safeUnset")}</option>
    </select>

    <select
      bind:value={filters.hasAntiCheat}
      aria-label={t("games.filterAnyAc")}
      class="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value={null}>{t("games.filterAnyAc")}</option>
      <option value={true}>{t("games.filterHasAc")}</option>
      <option value={false}>{t("games.filterNoAc")}</option>
    </select>

    <label class="flex cursor-pointer items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        bind:checked={filters.hideDead}
        class="size-3.5 accent-[hsl(var(--primary))]"
      />
      {t("games.hideDead")}
    </label>

    {#if filters.active}
      <Button variant="ghost" size="sm" onclick={() => filters.reset()}>
        <X class="size-3.5" />
        {t("games.clearFilters")}
      </Button>
    {/if}

    <span class="ml-auto text-xs text-muted-foreground tnum">
      {t("games.showing", {
        shown: formatNumber(sorted.length),
        total: formatNumber(records.length),
      })}
    </span>
  </div>

  {#if !sorted.length}
    <div class="rounded-lg border bg-card py-20 text-center">
      <p class="text-sm text-muted-foreground">{t("games.noResults")}</p>
      {#if filters.active}
        <Button class="mt-4" variant="outline" size="sm" onclick={() => filters.reset()}>
          {t("games.clearFilters")}
        </Button>
      {/if}
    </div>
  {:else}
    <div class="hidden md:block">
      <GamesTable rows={visible} />
    </div>
    <div class="md:hidden">
      <MobileGameCards rows={visible} />
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <!-- common.rowsPerPage is "{{n}}/page" and common.page is
           "{{current}}/{{total}}" - both are whole phrases with their numbers
           inside, not standalone labels. Using either as a bare caption printed
           the raw placeholder on screen. -->
      <label class="flex items-center gap-1.5">
        <span class="sr-only">{t("common.rowsPerPage", { n: filters.pageSize })}</span>
        <select
          bind:value={filters.pageSize}
          class="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
        >
          {#each PAGE_SIZES as size (size)}
            <option value={size}>{size === -1 ? t("common.all") : size}</option>
          {/each}
        </select>
      </label>

      {#if pageCount > 1}
        <div class="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page === 0}
            onclick={() => (filters.page = Math.max(0, filters.page - 1))}
          >
            {t("common.previous")}
          </Button>
          <span class="tnum">{t("common.page", { current: filters.page + 1, total: pageCount })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page >= pageCount - 1}
            onclick={() => (filters.page = Math.min(pageCount - 1, filters.page + 1))}
          >
            {t("common.next")}
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</QueryState>
