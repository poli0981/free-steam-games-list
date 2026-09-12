<script lang="ts">
  import Menu from "@lucide/svelte/icons/menu";
  import Search from "@lucide/svelte/icons/search";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import Monitor from "@lucide/svelte/icons/monitor";
  import { goto } from "$app/navigation";
  import { filters } from "../filters.svelte";
  import { games } from "../games.svelte";
  import { i18n } from "../i18n.svelte";
  import { theme, type Theme } from "../prefs.svelte";
  import { openPalette } from "../palette.svelte";
  import { formatNumber } from "../utils";
  import { cn } from "../utils";

  let { onOpenMenu }: { onOpenMenu: () => void } = $props();

  const t = i18n.t;

  const total = $derived(games.data?.records.length ?? 0);
  const lastUpdated = $derived(games.data?.index.last_updated ?? "");

  const THEMES: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "settings.themeLight" },
    { value: "dark", icon: Moon, label: "settings.themeDark" },
    { value: "system", icon: Monitor, label: "settings.themeSystem" },
  ];

  // Typing in the header search jumps to /games, because the box filters the
  // table and staying on /charts while it silently filtered a table you cannot
  // see is the kind of thing that reads as a broken search.
  function onSearchInput() {
    if (filters.search && !location.pathname.startsWith("/games")) void goto("/games");
  }
</script>

<header
  class="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md sm:px-4"
>
  <button
    type="button"
    class="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
    onclick={onOpenMenu}
    aria-label={t("nav.menu")}
  >
    <Menu class="size-5" />
  </button>

  <div class="relative min-w-0 flex-1 sm:max-w-md">
    <Search
      class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
    />
    <input
      type="search"
      bind:value={filters.search}
      oninput={onSearchInput}
      placeholder={t("topbar.searchPlaceholder")}
      aria-label={t("topbar.searchPlaceholder")}
      class="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-16 text-sm
             placeholder:text-muted-foreground"
    />
    <button
      type="button"
      onclick={openPalette}
      class="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5
             font-mono text-[10px] text-muted-foreground hover:text-foreground sm:block"
      aria-label={t("cmdk.open")}
    >
      Ctrl K
    </button>
  </div>

  {#if total}
    <p class="ml-auto hidden truncate text-xs text-muted-foreground xl:block">
      <span class="font-medium text-foreground tnum">{formatNumber(total)}</span>
      {t("topbar.gamesTracked")}
      {#if lastUpdated}
        · <span class="tnum">{lastUpdated.slice(0, 10)}</span>
      {/if}
    </p>
  {/if}

  <div
    class={cn("flex items-center gap-0.5 rounded-md border p-0.5", total ? "" : "ml-auto")}
    role="group"
    aria-label={t("settings.theme")}
  >
    {#each THEMES as option (option.value)}
      <button
        type="button"
        onclick={() => theme.set(option.value)}
        aria-pressed={theme.value === option.value}
        title={t(option.label)}
        aria-label={t(option.label)}
        class={cn(
          "grid size-7 place-items-center rounded transition-colors",
          theme.value === option.value
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <option.icon class="size-4" />
      </button>
    {/each}
  </div>
</header>
