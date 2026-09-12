<script lang="ts">
  import "../index.css";
  import { onMount, type Snippet } from "svelte";
  import { Toaster } from "svelte-sonner";
  import { page } from "$app/state";
  import { i18n } from "$lib/i18n.svelte";
  import { consent, theme, welcome } from "$lib/prefs.svelte";
  import { installPaletteShortcut } from "$lib/palette.svelte";
  import { games } from "$lib/games.svelte";
  import { upgradeLegacyHashUrl } from "$lib/legacy-url";
  import ConsentGate from "$lib/common/ConsentGate.svelte";
  import Sidebar from "$lib/layout/Sidebar.svelte";
  import Topbar from "$lib/layout/Topbar.svelte";
  import CommandPalette from "$lib/common/CommandPalette.svelte";
  import BackToTop from "$lib/common/BackToTop.svelte";
  // ?url so Vite returns the fingerprinted path. The previous version had
  // the content hash typed into the href, which stops matching the moment
  // the font or the bundler changes - and a preload that 404s is worse than
  // no preload, because the browser still pays for the request.
  import displayFont from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url";
  import bodyFont from "@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?url";

  let { children }: { children: Snippet } = $props();

  let ready = $state(false);
  let menuOpen = $state(false);
  let main: HTMLElement | undefined = $state();

  // Chrome-less routes: the introduction and the error pages stand alone, with
  // no sidebar or topbar around them.
  const bare = $derived(
    page.url.pathname === "/welcome" || page.url.pathname.startsWith("/error"),
  );

  onMount(() => {
    // Everything here touches localStorage or matchMedia, so none of it can run
    // during prerender. Order matters: the URL upgrade must happen before the
    // router settles on a route, and i18n must resolve before the first paint
    // of translated text or the UI flashes raw keys.
    upgradeLegacyHashUrl();
    theme.hydrate();
    consent.hydrate();
    welcome.hydrate();

    void i18n.init().then(() => {
      ready = true;
      // Only start the ~6 MB catalogue fetch once the gate is passed: a
      // visitor who declines should never have caused the download.
      if (consent.accepted) void games.load();
    });

    return installPaletteShortcut();
  });

  // Picks up the load for someone who accepts the terms in this session.
  $effect(() => {
    if (ready && consent.accepted) void games.load();
  });

  // Close the mobile drawer on navigation, or it stays open over the new page.
  $effect(() => {
    void page.url.pathname;
    menuOpen = false;
  });
</script>

<svelte:head>
  <!-- Fonts are same-origin and render-blocking-adjacent: preloading the two
       faces that appear above the fold removes the swap flash. The others are
       gated by unicode-range and must NOT be preloaded, or every visitor
       downloads a subset they cannot read. crossorigin is required even
       same-origin, or the preload is fetched twice. -->
  <link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href={displayFont} />
  <link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href={bodyFont} />
</svelte:head>

{#if ready}
  <ConsentGate>
    {#if bare}
      {@render children()}
    {:else}
      <a href="#main" class="skip-link">{i18n.t("common.skipToContent")}</a>

      <div class="flex h-dvh overflow-hidden">
        <aside class="hidden w-60 shrink-0 border-r bg-card/40 lg:block">
          <Sidebar />
        </aside>

        {#if menuOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onclick={() => (menuOpen = false)}
          ></div>
          <aside
            class="fixed inset-y-0 left-0 z-50 w-72 border-r bg-card shadow-xl lg:hidden"
            aria-label={i18n.t("nav.menu")}
          >
            <Sidebar onNavigate={() => (menuOpen = false)} />
          </aside>
        {/if}

        <div class="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenMenu={() => (menuOpen = true)} />
          <main
            bind:this={main}
            id="main"
            class="flex-1 overflow-y-auto scrollbar-thin"
            style="padding-bottom: env(safe-area-inset-bottom)"
          >
            <div class="container py-6">
              {@render children()}
            </div>
          </main>
        </div>
      </div>

      <CommandPalette />
      <BackToTop scroller={main} />
    {/if}
  </ConsentGate>
{/if}

<!-- theme, not a hardcoded "dark": main.tsx pinned the Toaster to dark while
     the rest of the app had a working light mode, so every toast was a dark
     card on a white page. -->
<Toaster theme={theme.resolved} position="bottom-right" richColors closeButton />
