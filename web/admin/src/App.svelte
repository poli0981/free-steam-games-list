<script lang="ts">
  import { onMount } from "svelte";
  import { Toaster } from "svelte-sonner";
  import Inbox from "@lucide/svelte/icons/inbox";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import HeartPulse from "@lucide/svelte/icons/heart-pulse";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import Monitor from "@lucide/svelte/icons/monitor";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { theme, type Theme } from "../../src/lib/prefs.svelte";
  import { router } from "./lib/router.svelte";
  import { api, SessionExpiredError } from "./lib/api";
  import { reportError } from "./lib/notify";
  import type { MeResponse } from "../../shared/admin-api";
  import type { AdminRoute } from "../../shared/admin-routes";
  import QueueView from "./views/QueueView.svelte";
  import EditView from "./views/EditView.svelte";
  import JobsView from "./views/JobsView.svelte";
  import AuditView from "./views/AuditView.svelte";
  import HealthView from "./views/HealthView.svelte";
  import NotFound from "./views/NotFound.svelte";

  /** Every entry in shared/admin-routes.ts, and nothing else (app.test.ts). */
  const NAV: { path: AdminRoute; label: string; title: string; icon: typeof Inbox }[] = [
    { path: "/admin", label: "Queue", title: "Review queue", icon: Inbox },
    { path: "/admin/edit", label: "Edit", title: "Correct published games", icon: SquarePen },
    { path: "/admin/jobs", label: "Jobs", title: "Commit jobs", icon: GitCommitHorizontal },
    { path: "/admin/audit", label: "Audit", title: "Audit log", icon: ScrollText },
    { path: "/admin/health", label: "Health", title: "Health", icon: HeartPulse },
  ];

  const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  let me = $state.raw<MeResponse | null>(null);

  onMount(() => {
    theme.hydrate();
    const uninstall = router.install();
    api<MeResponse>("/api/admin/me")
      .then((m) => (me = m))
      .catch((err) => {
        if (err instanceof SessionExpiredError) reportError(err);
      });
    return uninstall;
  });

  const current = $derived(NAV.find((n) => n.path === router.route));

  $effect(() => {
    document.title = `${current?.title ?? "Not found"} · F2P admin`;
  });

  function cycleTheme() {
    const i = THEMES.findIndex((t) => t.value === theme.value);
    theme.set(THEMES[(i + 1) % THEMES.length].value);
  }

  const themeNow = $derived(THEMES.find((t) => t.value === theme.value) ?? THEMES[1]);
</script>

<div class="min-h-dvh bg-background text-foreground">
  <a
    href="#main"
    class="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >Skip to content</a
  >
  <header class="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
    <div class="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-4">
      <a href="/admin" class="flex shrink-0 items-center gap-2 font-display text-base font-semibold">
        <span class="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">F2P</span>
        <span class="hidden sm:inline">Admin</span>
      </a>
      <nav aria-label="Admin" class="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 scrollbar-thin">
        {#each NAV as item (item.path)}
          {@const active = router.route === item.path}
          <a
            href={item.path}
            aria-current={active ? "page" : undefined}
            class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors
              {active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
          >
            <item.icon class="size-4" />
            <span class="hidden md:inline">{item.label}</span>
            <span class="sr-only md:hidden">{item.label}</span>
          </a>
        {/each}
      </nav>
      <div class="flex shrink-0 items-center gap-1">
        {#if me}
          <span class="hidden max-w-48 truncate text-xs text-muted-foreground lg:inline" title="Signed in with Cloudflare Access">
            {me.email}
          </span>
        {/if}
        <a
          href="https://free-steam-games.win"
          target="_blank"
          rel="noopener noreferrer"
          class="hidden items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground sm:inline-flex"
        >
          Site <ExternalLink class="size-3" />
        </a>
        <button
          type="button"
          class="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Theme: {themeNow.label}. Click to change."
          aria-label="Theme: {themeNow.label}. Click to change."
          onclick={cycleTheme}
        >
          <themeNow.icon class="size-4" />
        </button>
      </div>
    </div>
  </header>

  <main id="main" class="mx-auto max-w-7xl px-4 py-6 pb-24">
    {#if router.route === "/admin"}
      <QueueView />
    {:else if router.route === "/admin/edit"}
      <EditView />
    {:else if router.route === "/admin/jobs"}
      <JobsView />
    {:else if router.route === "/admin/audit"}
      <AuditView />
    {:else if router.route === "/admin/health"}
      <HealthView />
    {:else}
      <NotFound />
    {/if}
  </main>
</div>

<Toaster theme={theme.resolved} position="bottom-right" richColors closeButton />
