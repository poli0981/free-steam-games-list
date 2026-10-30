<script lang="ts">
  import { Dialog } from "bits-ui";
  import Search from "@lucide/svelte/icons/search";
  import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
  import ArrowUpDown from "@lucide/svelte/icons/arrow-up-down";
  import { goto } from "$app/navigation";
  import { palette } from "../palette.svelte";
  import { paletteRoutes } from "../nav";
  import { CHART_PAGES } from "../chart-nav";
  import { games } from "../games.svelte";
  import { i18n } from "../i18n.svelte";
  import { appidOf } from "../data-store";
  import { headerToCapsule, thumbFallback } from "../image";
  import { imgFallback } from "../img-fallback";
  import { cn } from "../utils";
  import { longEnough, searchKey } from "../search-fold";

  const t = i18n.t;

  /**
   * Built from the nav lists, not from a second hardcoded array - and
   * deduplicated there, because the list is rendered in a keyed each and a
   * duplicate key throws in production.
   */
  const routes = paletteRoutes(CHART_PAGES);

  // Folded (lib/search-fold.ts): a name typed in another width or kana script
  // still matches. Folded BEFORE trimming, which turns U+3000 into a space.
  const q = $derived(searchKey(palette.query).trim());

  const matchedRoutes = $derived(
    q ? routes.filter((r) => searchKey(t(r.i18n)).includes(q) || r.to.includes(q)) : routes,
  );

  // Once per record set, not per keystroke; derived lazily, so only once the
  // palette is first searched.
  const gameKeys = $derived((games.data?.records ?? []).map((g) => searchKey(g.name ?? "")));

  // Capped at 8: the palette is for jumping somewhere, not for browsing the
  // catalogue - /games is for that. Two characters, or one kanji, kana or
  // Hangul syllable, which is already a word.
  const matchedGames = $derived.by(() => {
    if (!longEnough(q, 2)) return [];
    const all = games.data?.records ?? [];
    const keys = gameKeys;
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const g = all[i];
      // Only rows with an appid: a game is reachable by /games/<appid> alone,
      // and `items` below indexes games by position.
      if (keys[i].includes(q) && appidOf(g)) out.push(g);
      if (out.length >= 8) break;
    }
    return out;
  });

  /**
   * One flat list of destinations, in render order, so the arrow keys walk
   * pages and games as a single sequence. The footer has always promised
   * "↵ to select"; until now nothing but the mouse could.
   */
  const items = $derived([
    ...matchedRoutes.map((r) => ({ id: `route:${r.to}`, to: r.to })),
    ...matchedGames.flatMap((g) => {
      const appid = appidOf(g);
      return appid ? [{ id: `game:${appid}`, to: `/games/${appid}` }] : [];
    }),
  ]);

  let active = $state(0);

  // A new query starts from the top; a shrinking list never points past its end.
  $effect(() => {
    void q;
    active = 0;
  });
  $effect(() => {
    if (active >= items.length) active = Math.max(0, items.length - 1);
  });

  const optionId = (id: string) => `cmdk-${id.replace(/[^\w-]/g, "_")}`;
  const activeId = $derived(items[active] ? optionId(items[active].id) : undefined);

  // Keep the highlighted option visible while the arrow keys move past the
  // scroll area's edge.
  $effect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  });

  function go(to: string) {
    palette.hide();
    void goto(to);
  }

  function onKeydown(e: KeyboardEvent) {
    // IME composition (Telex/VNI) uses these keys too.
    if (e.isComposing || e.keyCode === 229) return;
    const last = items.length - 1;
    if (last < 0) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        active = active >= last ? 0 : active + 1;
        break;
      case "ArrowUp":
        e.preventDefault();
        active = active <= 0 ? last : active - 1;
        break;
      case "Home":
        e.preventDefault();
        active = 0;
        break;
      case "End":
        e.preventDefault();
        active = last;
        break;
      case "Enter": {
        const item = items[active];
        if (item) {
          e.preventDefault();
          go(item.to);
        }
        break;
      }
    }
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
          onkeydown={onKeydown}
          placeholder={t("cmdk.placeholder")}
          aria-label={t("cmdk.placeholder")}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          class="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div id="cmdk-list" role="listbox" aria-label={t("cmdk.title")} class="max-h-[55vh] overflow-y-auto scrollbar-slim scrollbar-panel p-2">
        {#if matchedRoutes.length}
          <p class="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" role="presentation">
            {t("cmdk.pages")}
          </p>
          {#each matchedRoutes as r, i (r.to)}
            {@const id = optionId(`route:${r.to}`)}
            <button
              {id}
              type="button"
              role="option"
              aria-selected={active === i}
              tabindex="-1"
              onclick={() => go(r.to)}
              onmousemove={() => (active = i)}
              class={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
                active === i ? "bg-accent" : "hover:bg-accent",
              )}
            >
              <r.icon class="size-4 shrink-0 text-muted-foreground" />
              <span class="flex-1 truncate">{t(r.i18n)}</span>
              <span class="font-mono text-[11px] text-muted-foreground">{r.to}</span>
            </button>
          {/each}
        {/if}

        {#if matchedGames.length}
          <p class="mt-2 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" role="presentation">
            {t("cmdk.games")}
          </p>
          {#each matchedGames as g, gi (g.link)}
            {@const appid = appidOf(g)}
            {@const index = matchedRoutes.length + gi}
            <button
              id={appid ? optionId(`game:${appid}`) : undefined}
              type="button"
              role="option"
              aria-selected={active === index}
              tabindex="-1"
              onclick={() => appid && go(`/games/${appid}`)}
              onmousemove={() => (active = index)}
              class={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
                active === index ? "bg-accent" : "hover:bg-accent",
              )}
            >
              {#if g.header_image}
                <img
                  src={headerToCapsule(g.header_image)}
                  {@attach imgFallback(thumbFallback(g.header_image))}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerpolicy="no-referrer"
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
          <ArrowUpDown class="size-3" />
          {t("cmdk.kbdNavigate")}
        </span>
        <span class="inline-flex items-center gap-1">
          <CornerDownLeft class="size-3" />
          {t("cmdk.toSelect")}
        </span>
        <span>
          <kbd class="font-mono">{t("cmdk.escKey")}</kbd>
          {t("cmdk.toClose")}
        </span>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
