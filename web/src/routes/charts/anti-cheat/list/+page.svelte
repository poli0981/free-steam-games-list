<script lang="ts">
  import Search from "@lucide/svelte/icons/search";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { acLevel, bucketByAntiCheat, type AcLevel } from "$lib/anti-cheat";
  import { appidOf } from "$lib/data-store";
  import { cn, formatNumber, parseIntSafe } from "$lib/utils";
  import type { GameRecord } from "$lib/schema";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import Badge, { type BadgeVariant } from "$lib/ui/Badge.svelte";
  import Seo from "$lib/common/Seo.svelte";

  const t = i18n.t;

  type SortKey = "name" | "family" | "level" | "genre" | "players";

  interface Row {
    game: GameRecord;
    appid: string | null;
    family: string;
    level: AcLevel;
    players: number;
  }

  /** Literal keys, so i18n.test.ts can see them. */
  const LEVEL: Record<AcLevel, { label: string; variant: BadgeVariant }> = {
    kernel: { label: "charts.acLevel.kernel", variant: "destructive" },
    user: { label: "charts.acLevel.user", variant: "secondary" },
    unknown: { label: "charts.acLevel.unknown", variant: "outline" },
    none: { label: "charts.acLevel.none", variant: "outline" },
  };
  // Kernel first when sorting by level: it is the column people come here for.
  const LEVEL_ORDER: Record<AcLevel, number> = { kernel: 0, user: 1, unknown: 2, none: 3 };

  const buckets = $derived(bucketByAntiCheat(games.data?.records ?? []));
  const rows = $derived(
    buckets.flatMap((b) =>
      b.games.map((game): Row => ({
        game,
        appid: appidOf(game),
        family: b.key,
        level: acLevel(game),
        players: parseIntSafe(game.current_players),
      })),
    ),
  );

  let search = $state("");
  let family = $state<string | null>(null);
  // Biggest audience first: an anti-cheat's reputation is set by the games
  // people actually play with it.
  let sortKey = $state<SortKey>("players");
  let sortDir = $state<"asc" | "desc">("desc");

  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (!family || r.family === family) &&
        (!q ||
          (r.game.name ?? "").toLowerCase().includes(q) ||
          r.family.toLowerCase().includes(q) ||
          (r.game.anti_cheat ?? "").toLowerCase().includes(q)),
    );
    const value = (r: Row): string | number =>
      sortKey === "name"
        ? (r.game.name ?? "").toLowerCase()
        : sortKey === "family"
          ? r.family.toLowerCase()
          : sortKey === "level"
            ? LEVEL_ORDER[r.level]
            : sortKey === "genre"
              ? (r.game.genre ?? "").toLowerCase()
              : r.players;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av !== bv) return (av < bv ? -1 : 1) * factor;
      return b.players - a.players;
    });
  });

  function sortBy(key: SortKey) {
    if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
    else {
      sortKey = key;
      // Numbers read best largest-first, words alphabetically.
      sortDir = key === "players" ? "desc" : "asc";
    }
  }

  const COLUMNS: { key: SortKey; label: string; class: string }[] = [
    { key: "name", label: "antiCheatList.game", class: "" },
    { key: "family", label: "antiCheatList.families", class: "" },
    { key: "level", label: "antiCheatList.kernel", class: "" },
    { key: "genre", label: "antiCheatList.genre", class: "hidden md:table-cell" },
    { key: "players", label: "antiCheatList.players", class: "text-right" },
  ];
</script>

<!-- A static description: this page is prerendered with no data, so any
     count baked in here would read "0" - and before the fix it shipped the
     raw "{{total}}" placeholder into the search-result snippet. -->
<Seo title={t("antiCheatList.title")} description={t("antiCheatList.seoDescription")} />

<PageHeader
  title={t("antiCheatList.title")}
  subtitle={games.data
    ? t("antiCheatList.subtitle", {
        total: formatNumber(rows.length),
        families: formatNumber(buckets.length),
      })
    : t("antiCheatList.seoDescription")}
/>

<QueryState loading={games.pending} error={games.error} retry={() => games.refetch()}>
  <div class="space-y-3">
    <div class="flex flex-wrap gap-1.5" role="group" aria-label={t("antiCheatList.families")}>
      <button
        type="button"
        aria-pressed={family === null}
        onclick={() => (family = null)}
        class={cn(
          "rounded-md border px-2.5 py-1 text-xs transition-colors",
          family === null ? "border-primary/50 bg-primary/10 text-foreground" : "hover:bg-accent",
        )}
      >
        {t("common.all")} <span class="text-muted-foreground tnum">{formatNumber(rows.length)}</span>
      </button>
      {#each buckets as bucket (bucket.key)}
        <button
          type="button"
          aria-pressed={family === bucket.key}
          onclick={() => (family = family === bucket.key ? null : bucket.key)}
          class={cn(
            "rounded-md border px-2.5 py-1 text-xs transition-colors",
            family === bucket.key ? "border-primary/50 bg-primary/10 text-foreground" : "hover:bg-accent",
          )}
        >
          {bucket.key} <span class="text-muted-foreground tnum">{formatNumber(bucket.games.length)}</span>
        </button>
      {/each}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-52 flex-1 sm:max-w-xs">
        <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          bind:value={search}
          placeholder={t("common.search")}
          aria-label={t("common.search")}
          class="h-8 w-full rounded-md border border-input bg-background pr-3 pl-8 text-xs placeholder:text-muted-foreground"
        />
      </div>
      <span class="ml-auto text-xs text-muted-foreground tnum">
        {t("games.showing", { shown: formatNumber(shown.length), total: formatNumber(rows.length) })}
      </span>
    </div>

    <div class="overflow-x-auto rounded-lg border bg-card">
      <table class="w-full text-sm">
        <thead class="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            {#each COLUMNS as col (col.key)}
              <th
                scope="col"
                class={cn("px-3 py-2 font-medium", col.class)}
                aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              >
                <button
                  type="button"
                  onclick={() => sortBy(col.key)}
                  class={cn("inline-flex items-center gap-1 hover:text-foreground", col.key === "players" && "flex-row-reverse")}
                >
                  {t(col.label)}
                  {#if sortKey === col.key}
                    {#if sortDir === "asc"}<ArrowUp class="size-3" />{:else}<ArrowDown class="size-3" />{/if}
                  {:else}
                    <ChevronsUpDown class="size-3 opacity-40" />
                  {/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody class="divide-y">
          {#each shown as row (row.game.link)}
            <tr class="transition-colors hover:bg-accent/50">
              <td class="max-w-72 px-3 py-2">
                <a href={row.appid ? `/games/${row.appid}` : row.game.link} class="block truncate font-medium hover:text-primary">
                  {row.game.name || "—"}
                </a>
              </td>
              <td class="px-3 py-2 whitespace-nowrap" title={row.game.anti_cheat}>{row.family}</td>
              <td class="px-3 py-2">
                <Badge variant={LEVEL[row.level].variant} class="whitespace-nowrap">{t(LEVEL[row.level].label)}</Badge>
              </td>
              <td class="hidden px-3 py-2 text-muted-foreground md:table-cell">{row.game.genre || "—"}</td>
              <td class="px-3 py-2 text-right font-mono text-xs tnum">{formatNumber(row.game.current_players)}</td>
            </tr>
          {:else}
            <tr>
              <td colspan={COLUMNS.length} class="px-3 py-10 text-center text-sm text-muted-foreground">
                {t("games.noResults")}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</QueryState>
