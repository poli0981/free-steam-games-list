<script lang="ts">
  import { page } from "$app/state";
  import { PRIMARY, SECONDARY, isActive } from "../nav";
  import { i18n } from "../i18n.svelte";
  import { cn } from "../utils";
  import Gamepad from "@lucide/svelte/icons/gamepad-2";

  let { onNavigate }: { onNavigate?: () => void } = $props();

  const t = i18n.t;
</script>

<div class="flex h-full flex-col gap-1 overflow-y-auto scrollbar-thin px-3 py-4">
  <a
    href="/"
    onclick={onNavigate}
    class="mb-4 flex items-center gap-2.5 px-2 focus-visible:rounded-md"
  >
    <span class="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
      <Gamepad class="size-4" />
    </span>
    <span class="min-w-0">
      <span class="block truncate font-display text-[15px] font-semibold leading-tight">
        F2P Tracker
      </span>
      <!-- Derived, not hardcoded. The old rail said "Steam · v1.0" while
           package.json was at 1.4.5 — a literal that nothing updated. -->
      <span class="block truncate text-[11px] leading-tight text-muted-foreground tnum">
        Steam · v{__APP_VERSION__}
      </span>
    </span>
  </a>

  <nav aria-label={t("nav.primary")} class="flex flex-col gap-0.5">
    {#each PRIMARY as item (item.to)}
      {@const active = isActive(page.url.pathname, item)}
      <a
        href={item.to}
        onclick={onNavigate}
        aria-current={active ? "page" : undefined}
        class={cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-primary/12 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <item.icon class="size-4 shrink-0" />
        <span class="truncate">{t(item.i18n)}</span>
      </a>
    {/each}
  </nav>

  <div class="mt-6 px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
    {t("nav.manage")}
  </div>

  <nav aria-label={t("nav.secondary")} class="flex flex-col gap-0.5">
    {#each SECONDARY as item (item.to)}
      {@const active = isActive(page.url.pathname, item)}
      <a
        href={item.to}
        onclick={onNavigate}
        aria-current={active ? "page" : undefined}
        class={cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-primary/12 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <item.icon class="size-4 shrink-0" />
        <span class="truncate">{t(item.i18n)}</span>
      </a>
    {/each}
  </nav>

  <div class="mt-auto px-2.5 pt-4">
    <a
      href="https://github.com/poli0981/free-steam-games-list"
      target="_blank"
      rel="noreferrer"
      class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {t("nav.sourceOnGitHub")}
    </a>
  </div>
</div>
