<script lang="ts">
  import { Dialog } from "bits-ui";
  import Search from "@lucide/svelte/icons/search";
  import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
  import { goto } from "$app/navigation";
  import { palette } from "../palette.svelte";
  import { PRIMARY, SECONDARY, EXTRA, type NavItem } from "../nav";
  import { CHART_PAGES } from "../chart-nav";
  import { games } from "../games.svelte";
  import { i18n } from "../i18n.svelte";
  import { appidOf } from "../data-store";
  import { headerToCapsule } from "../image";
  import { cn } from "../utils";

  const t = i18n.t;

  /**
   * Built from the nav lists, not from a second hardcoded array.
   *
   * The React palette carried its own list of 17 entries with English labels -
   * the only untranslated strings in an otherwise fully translated app - and it
   * had already drifted, missing /top-offline, /donate,
   * /charts/anti-cheat/list, /charts/delisted and /welcome.
   */
  const routes: NavItem[] = [
    ...PRIMARY,
    ...CHART_PAGES.map((c) => ({ to: c.to, i18n: c.i18n, icon: c.icon })),
    ...SECONDARY,
    ...EXTRA,
  ];

  const q = $derived(palette.query.trim().toLowerCase());

  const matchedRoutes = $derived(
    q ? routes.filter((r) => t(r.i18n).toLowerCase().includes(q) || r.to.includes(q)) : routes,
  );

  // Capped at 8: the palette is for jumping somewhere, not for browsing the
  // catalogue - /games is for that.
  const matchedGames = $derived.by(() => {
    if (q.length < 2) return [];
    const all = games.data?.records ?? [];
    const out = [];
    for (const g of all) {
      if (g.name?.toLowerCase().includes(q)) out.push(g);
      if (out.length >= 8) break;
    }
    return out;
  });

  function go(to: string) {
    palette.hide();
    void goto(to);
  }
</script>

<Dialog.Root bind:open={palette.open}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed left-1/2 top-[12vh] z-50 w-[min(38rem,92vw)] -translate-x-1/2 overflow-hidden
             rounded-xl border bg-card shadow-2xl"
    >
      <Dialog.Title class="sr-only">{t("cmdk.title")}</Dialog.Title>

      <div class="flex items-center gap-2 border-b px-3">
        <Search class="size-4 shrink-0 text-muted-foreground" />
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          bind:value={palette.query}
          placeholder={t("cmdk.placeholder")}
          aria-label={t("cmdk.placeholder")}
          class="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div class="max-h-[55vh] overflow-y-auto scrollbar-thin p-2">
        {#if matchedRoutes.length}
          <p class="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("cmdk.pages")}
          </p>
          {#each matchedRoutes as r (r.to)}
            <button
              type="button"
              onclick={() => go(r.to)}
              class={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
                "hover:bg-accent focus-visible:bg-accent",
              )}
            >
              <r.icon class="size-4 shrink-0 text-muted-foreground" />
              <span class="flex-1 truncate">{t(r.i18n)}</span>
              <span class="font-mono text-[11px] text-muted-foreground">{r.to}</span>
            </button>
          {/each}
        {/if}

        {#if matchedGames.length}
          <p class="mt-2 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("cmdk.games")}
          </p>
          {#each matchedGames as g (g.link)}
            {@const appid = appidOf(g)}
            <button
              type="button"
              onclick={() => appid && go(`/games/${appid}`)}
              class="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
            >
              {#if g.header_image}
                <img
                  src={headerToCapsule(g.header_image)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="h-6 w-[52px] shrink-0 rounded object-cover"
                />
              {/if}
              <span class="flex-1 truncate">{g.name}</span>
              <span class="font-mono text-[11px] text-muted-foreground tnum">{appid}</span>
            </button>
          {/each}
        {/if}

        {#if !matchedRoutes.length && !matchedGames.length}
          <p class="px-2 py-8 text-center text-sm text-muted-foreground">{t("cmdk.noResults")}</p>
        {/if}
      </div>

      <div class="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span class="inline-flex items-center gap-1">
          <CornerDownLeft class="size-3" />
          {t("cmdk.toSelect")}
        </span>
        <span>esc {t("cmdk.toClose")}</span>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
