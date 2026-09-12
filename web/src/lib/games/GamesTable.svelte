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
  import { headerToCapsule } from "../image";
  import { recordIssues } from "../validation";
  import { formatNumber, parseReviewPercent, cn } from "../utils";
  import Badge from "../ui/Badge.svelte";

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
  <div bind:this={viewport} class="h-[calc(100dvh-20rem)] overflow-auto scrollbar-thin">
    <div style:width="{TOTAL_WIDTH}px" style:min-width="100%">
      <!-- Sticky header. A real <table> cannot be virtualised without either
           losing sticky headers or fighting the row heights, so this is a grid
           that keeps the table SEMANTICS through role attributes. -->
      <div
        role="row"
        class="sticky top-0 z-10 flex h-10 items-center border-b bg-card/95 backdrop-blur"
      >
        {#each COLS as col (col.key)}
          {@const active = filters.sortKey === col.key}
          <div
            role="columnheader"
            aria-sort={active ? (filters.sortDir === "asc" ? "ascending" : "descending") : "none"}
            style:width="{col.width}px"
            class="shrink-0 px-2"
          >
            {#if col.label}
              <button
                type="button"
                disabled={!col.sortable}
                onclick={() => toggleSort(col.key, col.sortable)}
                title={col.sortable ? t("games.sortBy", { column: t(col.label) }) : undefined}
                class={cn(
                  "flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide",
                  col.align === "right" && "justify-end",
                  col.sortable ? "hover:text-foreground" : "cursor-default",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span class="truncate">{t(col.label)}</span>
                {#if col.sortable}
                  {#if !active}
                    <ChevronsUpDown class="size-3 shrink-0 opacity-40" />
                  {:else if filters.sortDir === "asc"}
                    <ChevronUp class="size-3 shrink-0" />
                  {:else}
                    <ChevronDown class="size-3 shrink-0" />
                  {/if}
                {/if}
              </button>
            {/if}
          </div>
        {/each}
      </div>

      <div style:height="{$virtualizer.getTotalSize()}px" class="relative">
        {#each items as item (item.key)}
          {@const g = rows[item.index]}
          {@const appid = appidOf(g)}
          {@const issues = recordIssues(g)}
          {@const pct = parseReviewPercent(g.reviews)}
          <a
            href={appid ? `/games/${appid}` : g.link}
            role="row"
            class="absolute left-0 flex items-center border-b text-sm transition-colors hover:bg-accent/60"
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
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width="92"
                      height="43"
                      class="h-8 w-14 rounded object-cover"
                    />
                  {:else}
                    <div class="h-8 w-14 rounded bg-muted"></div>
                  {/if}
                {:else if col.key === "issues"}
                  {#if issues.length}
                    <span
                      class="grid size-5 place-items-center text-warning"
                      title={issues.map((i) => i.label).join(" · ")}
                    >
                      <TriangleAlert class="size-3.5" />
                    </span>
                  {/if}
                {:else if col.key === "name"}
                  <span class="font-medium">
                    {#if g.is_dead}<span title={t("games.deadTitle")} class="mr-1">💀</span>{/if}
                    {g.name || "—"}
                  </span>
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
                {:else if col.key === "anti_cheat"}
                  {#if g.anti_cheat && g.anti_cheat !== "-"}
                    <Badge variant={g.is_kernel_ac ? "destructive" : "warning"}>{g.anti_cheat}</Badge>
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
                  <!-- stopPropagation so the Steam link does not also trigger
                       the row navigation wrapping it. -->
                  <span
                    role="link"
                    tabindex="0"
                    title={t("detail.openOnSteam")}
                    onclick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.open(g.link, "_blank", "noopener,noreferrer");
                    }}
                    onkeydown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(g.link, "_blank", "noopener,noreferrer");
                      }
                    }}
                    class="inline-grid size-6 place-items-center text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink class="size-3.5" />
                  </span>
                {/if}
              </div>
            {/each}
          </a>
        {/each}
      </div>
    </div>
  </div>
</div>
