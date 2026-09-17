<script lang="ts">
  import Menu from "@lucide/svelte/icons/menu";
  import Search from "@lucide/svelte/icons/search";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import Monitor from "@lucide/svelte/icons/monitor";
  import Download from "@lucide/svelte/icons/download";
  import { pwa } from "../pwa-state.svelte";
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
  const offline = $derived(games.data?.offline ?? false);
  const updating = $derived(Boolean(games.data?.updating));

  const THEMES: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "settings.themeLight" },
    { value: "dark", icon: Moon, label: "settings.themeDark" },
    { value: "system", icon: Monitor, label: "settings.themeSystem" },
  ];

  // "Ctrl K" is what the prerendered HTML says, because the build cannot know
  // the reader's platform; an Apple keyboard gets "⌘K" once the page is live.
  // An $effect rather than a render-time check, so hydration still matches.
  let shortcut = $state("Ctrl K");
  $effect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      "";
    if (/mac|iphone|ipad|ipod/i.test(platform)) shortcut = "⌘K";
  });

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
      {shortcut}
    </button>
  </div>

  {#if total}
    <p class="ml-auto hidden truncate text-xs text-muted-foreground xl:block" aria-live="polite">
      <span class="font-medium text-foreground tnum">{formatNumber(total)}</span>
      {t("topbar.gamesTracked")}
      {#if offline && lastUpdated}
        · <span class="text-warning">{t("topbar.offlineCached", { date: lastUpdated.slice(0, 10) })}</span>
      {:else if lastUpdated}
        · <span class="tnum">{lastUpdated.slice(0, 10)}</span>
      {/if}
      {#if updating}
        · <span class="text-info">{t("topbar.updating")}</span>
      {/if}
    </p>
  {/if}

  {#if pwa.canInstall && !pwa.standalone}
    <button
      type="button"
      onclick={() => void pwa.install()}
      class={cn(
        "hidden h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-muted-foreground",
        "hover:bg-accent hover:text-foreground sm:inline-flex",
        total ? "" : "ml-auto",
      )}
      title={t("pwa.installHint")}
    >
      <Download class="size-3.5" />
      {t("pwa.install")}
    </button>
  {/if}

  <div
    class={cn(
      "flex items-center gap-0.5 rounded-md border p-0.5",
      total || (pwa.canInstall && !pwa.standalone) ? "" : "ml-auto",
    )}
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
