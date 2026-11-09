<script lang="ts">
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import type { GameRecord } from "../schema";
  import { COLS, TOTAL_WIDTH, reviewTone } from "./columns";
  import { filters } from "../filters.svelte";
  import { i18n } from "../i18n.svelte";
  import { appidOf } from "../data-store";
  import { headerToCapsule, thumbFallback } from "../image";
  import { imgFallback } from "../img-fallback";
  import { recordIssues } from "../validation";
  import { formatNumber, parseReviewPercent, cn } from "../utils";
  import Badge from "../ui/Badge.svelte";
  import AntiCheatBadge from "./AntiCheatBadge.svelte";

  let { rows }: { rows: GameRecord[] } = $props();

  const t = i18n.t;

  let viewport: HTMLDivElement | undefined = $state();

  // 44px rows, overscan 12 - carried over. Overscan matters on a fast scroll:
  // too low and rows paint blank, too high and the virtualiser stops earning
  // its keep.
  // $derived.by, and it READS `viewport` in the body.
  //
  // getScrollElement is a closure, so referencing `viewport` only inside it
  // does not register a dependency: the virtualizer was built once, before
  // bind:this had run, measured a null scroll element, and never rebuilt. The
  // symptom is subtle - getTotalSize() still returns the right height, so the
  // scrollbar looks correct, while getVirtualItems() returns nothing and every
  // row is blank.
  const virtualizer = $derived.by(() => {
    const el = viewport;
    return createVirtualizer<HTMLDivElement, HTMLDivElement>({
      count: rows.length,
      getScrollElement: () => el ?? null,
      estimateSize: () => 44,
      overscan: 12,
    });
  });

  const items = $derived($virtualizer.getVirtualItems());

  function toggleSort(key: string, sortable?: boolean) {
    if (!sortable) return;
    if (filters.sortKey !== key) {
      filters.sortKey = key;
      filters.sortDir = "asc";
    } else if (filters.sortDir === "asc") {
      filters.sortDir = "desc";
    } else {
      // Third click clears, rather than cycling back to asc: there is no other
      // way to get back to the natural order once you have sorted.
      filters.sortKey = null;
      filters.sortDir = null;
    }
  }
</script>

<div class="overflow-hidden rounded-lg border bg-card">
  <!-- min-h: the height follows the window, so at 300-400% zoom it reached
       zero and the list vanished. Taller than a tiny window, the page scrolls. -->
  <div bind:this={viewport} class="h-[calc(100dvh-20rem)] min-h-64 overflow-auto scrollbar-slim scrollbar-panel">
    <!-- A real <table> cannot be virtualised without either losing the sticky
         header or fighting the row heights, so this is a grid of divs with the
         ARIA table roles. They have to be complete to mean anything: the table
         around the rows, the row and column counts (only the rows on screen
         exist), and a row index on each. Rows used to be <a role="row"> with no
         table around them, which a screen reader announced as neither a link
         nor a table. -->
    <div
      role="table"
      aria-label={t("games.title")}
      aria-rowcount={rows.length + 1}
      aria-colcount={COLS.length}
      style:width="{TOTAL_WIDTH}px"
      style:min-width="100%"
    >
      <div
        role="row"
        aria-rowindex={1}
        class="sticky top-0 z-10 flex h-10 items-center border-b bg-card/95 backdrop-blur"
      >
        {#each COLS as col (col.key)}
          {@const active = filters.sortKey === col.key}
          <div
            role="columnheader"
            aria-sort={col.sortable ? (active ? (filters.sortDir === "asc" ? "ascending" : "descending") : "none") : undefined}
            style:width="{col.width}px"
            class="shrink-0 px-2"
          >
            {#if col.label && col.sortable}
              <button
                type="button"
                onclick={() => toggleSort(col.key, col.sortable)}
                title={t("games.sortBy", { column: t(col.label) })}
                class={cn(
                  "flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide hover:text-foreground",
                  col.align === "right" && "justify-end",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span class="truncate">{t(col.label)}</span>
                {#if !active}
                  <ChevronsUpDown class="size-3 shrink-0 opacity-40" />
                {:else if filters.sortDir === "asc"}
                  <ChevronUp class="size-3 shrink-0" />
                {:else}
                  <ChevronDown class="size-3 shrink-0" />
                {/if}
              </button>
            {:else if col.label}
              <!-- Not sortable: plain text, not a disabled button that a screen
                   reader announces as one. -->
              <span class="block truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(col.label)}
              </span>
            {:else if col.srLabel}
              <span class="sr-only">{t(col.srLabel)}</span>
            {/if}
          </div>
        {/each}
      </div>

      <div role="rowgroup" style:height="{$virtualizer.getTotalSize()}px" class="relative">
        {#each items as item (item.key)}
          {@const g = rows[item.index]}
          {@const appid = appidOf(g)}
          {@const issues = recordIssues(g)}
          {@const pct = parseReviewPercent(g.reviews)}
          <!-- The whole row still opens the game: the name's link stretches
               over it (after:absolute inset-0, against this positioned row), so
               there is one link per row instead of a row that is a link.
               Things that must stay hoverable or clickable on their own (the
               warning and dead-game tooltips, the Steam link) sit above it
               with relative z-[1]. Its focus ring is drawn by the row: the
               cells clip overflow and would cut an outline off. -->
          <div
            role="row"
            aria-rowindex={item.index + 2}
            class="absolute left-0 flex items-center border-b text-sm transition-colors hover:bg-accent/60 has-[:focus-visible]:bg-accent/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-inset"
            style:height="{item.size}px"
            style:width="{TOTAL_WIDTH}px"
            style:transform="translateY({item.start}px)"
          >
            {#each COLS as col (col.key)}
              <div
                role="cell"
                style:width="{col.width}px"
                class={cn(
                  "shrink-0 truncate px-2",
                  col.align === "right" && "text-right",
                )}
              >
                {#if col.key === "thumb"}
                  {#if g.header_image}
                    <img
                      src={headerToCapsule(g.header_image)}
                      {@attach imgFallback(thumbFallback(g.header_image))}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerpolicy="no-referrer"
                      width="92"
                      height="43"
                      class="h-8 w-14 rounded object-cover"
                    />
                  {:else}
                    <div class="h-8 w-14 rounded bg-muted"></div>
                  {/if}
                {:else if col.key === "issues"}
                  {#if issues.length}
                    {@const issueText = issues.map((i) => t(i.message, i.vars)).join(" · ")}
                    <span class="relative z-[1] grid size-5 place-items-center text-warning" title={issueText}>
                      <TriangleAlert class="size-3.5" />
                      <span class="sr-only">{issueText}</span>
                    </span>
                  {/if}
                {:else if col.key === "name"}
                  {#if g.is_dead}<span aria-hidden="true" title={t("games.deadTitle")} class="relative z-[1] mr-1">💀</span>{/if}
                  <a
                    href={appid ? `/games/${appid}` : g.link}
                    class="font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                  >
                    {g.name || "—"}{#if g.is_dead}<span class="sr-only">, {t("games.deadTitle")}</span>{/if}
                  </a>
                {:else if col.key === "genre"}
                  {#if g.genre}<Badge variant="outline">{g.genre}</Badge>{:else}<span class="text-muted-foreground">—</span>{/if}
                {:else if col.key === "type_game"}
                  {#if g.type_game}
                    <Badge variant={g.type_game === "online" ? "success" : "secondary"}>
                      {t(g.type_game === "online" ? "common.online" : "common.offline")}
                    </Badge>
                  {:else}<span class="text-muted-foreground">—</span>{/if}
                {:else if col.key === "reviews"}
                  {#if pct === null}
                    <span class="text-muted-foreground">—</span>
                  {:else}
                    <span class={cn("font-mono tnum", reviewTone(pct))}>{pct}%</span>
                  {/if}
                {:else if col.key === "current_players"}
                  <span class="font-mono tnum">{formatNumber(g.current_players)}</span>
                {:else if col.key === "all_time_peak"}
                  <span class="font-mono tnum">{formatNumber(g.all_time_peak)}</span>
                {:else if col.key === "anti_cheat"}
                  {#if g.anti_cheat && g.anti_cheat !== "-"}
                    <AntiCheatBadge name={g.anti_cheat} kernel={g.is_kernel_ac} />
                  {:else}<span class="text-muted-foreground">—</span>{/if}
                {:else if col.key === "platforms"}
                  <span class="text-xs text-muted-foreground">
                    {(g.platforms ?? []).join(", ") || "—"}
                  </span>
                {:else if col.key === "release_date"}
                  <span class="text-xs text-muted-foreground">{g.release_date || "—"}</span>
                {:else if col.key === "status"}
                  <Badge variant={g.status === "active" ? "secondary" : "destructive"}>
                    {t(g.status === "active" ? "common.active" : "common.delisted")}
                  </Badge>
                {:else if col.key === "link"}
                  <!-- A real link now that it is not nested inside the row's
                       own link, so the apps' external-link interceptor opens it
                       in the system browser like any other. Out of the Tab
                       order: one stop per row, not two, and a game's own page
                       has the same Steam links for the keyboard. Screen readers
                       still find it. -->
                  <a
                    href={g.link}
                    target="_blank"
                    rel="noreferrer"
                    tabindex="-1"
                    aria-label={t("games.openOnSteamNamed", { name: g.name || appid || "" })}
                    title={t("detail.openOnSteam", { appid: appidOf(g) })}
                    class="relative z-[1] inline-grid size-6 place-items-center text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink class="size-3.5" />
                  </a>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
