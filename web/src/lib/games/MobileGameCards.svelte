<script lang="ts">
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { GameRecord } from "../schema";
  import { i18n } from "../i18n.svelte";
  import { appidOf } from "../data-store";
  import { headerToCapsule } from "../image";
  import { recordIssues } from "../validation";
  import { formatNumber, parseReviewPercent, cn } from "../utils";
  import { reviewTone } from "./columns";
  import Badge from "../ui/Badge.svelte";

  // Below md the 1,282px-wide table is unusable, so the same rows render as
  // cards. Still virtualised: 3,700 cards is as many DOM nodes as 3,700 rows.
  let { rows }: { rows: GameRecord[] } = $props();

  const t = i18n.t;
  let viewport: HTMLDivElement | undefined = $state();

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
      estimateSize: () => 96,
      overscan: 8,
    });
  });

  const items = $derived($virtualizer.getVirtualItems());
</script>

<div bind:this={viewport} class="h-[calc(100dvh-18rem)] overflow-auto scrollbar-thin">
  <div style:height="{$virtualizer.getTotalSize()}px" class="relative">
    {#each items as item (item.key)}
      {@const g = rows[item.index]}
      {@const appid = appidOf(g)}
      {@const pct = parseReviewPercent(g.reviews)}
      {@const issues = recordIssues(g)}
      <a
        href={appid ? `/games/${appid}` : g.link}
        class="absolute left-0 right-0 flex gap-3 border-b px-1 py-3"
        style:height="{item.size}px"
        style:transform="translateY({item.start}px)"
      >
        {#if g.header_image}
          <img
            src={headerToCapsule(g.header_image)}
            alt=""
            loading="lazy"
            decoding="async"
            class="h-[42px] w-[90px] shrink-0 rounded object-cover"
          />
        {:else}
          <div class="h-[42px] w-[90px] shrink-0 rounded bg-muted"></div>
        {/if}

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            {#if g.is_dead}<span title={t("games.deadTitle")}>💀</span>{/if}
            <span class="truncate text-sm font-medium">{g.name || "—"}</span>
            {#if issues.length}
              <TriangleAlert
                class="size-3.5 shrink-0 text-warning"
                aria-label={issues.map((i) => i.label).join(" · ")}
              />
            {/if}
          </div>

          <div class="mt-1 flex flex-wrap items-center gap-1">
            {#if g.genre}<Badge variant="outline">{g.genre}</Badge>{/if}
            {#if g.type_game}
              <Badge variant={g.type_game === "online" ? "success" : "secondary"}>
                {t(g.type_game === "online" ? "common.online" : "common.offline")}
              </Badge>
            {/if}
            {#if g.anti_cheat && g.anti_cheat !== "-"}
              <Badge variant={g.is_kernel_ac ? "destructive" : "warning"}>{g.anti_cheat}</Badge>
            {/if}
          </div>
        </div>

        <div class="shrink-0 text-right">
          {#if pct !== null}
            <div class={cn("font-mono text-sm tnum", reviewTone(pct))}>{pct}%</div>
          {/if}
          <div class="font-mono text-xs text-muted-foreground tnum">
            {formatNumber(g.current_players)}
          </div>
        </div>
      </a>
    {/each}
  </div>
</div>
