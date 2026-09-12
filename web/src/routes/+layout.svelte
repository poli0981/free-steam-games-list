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
  import { recoverFallbackRoute } from "$lib/fallback-route";
  import { installExternalLinkInterceptor } from "$lib/external-link-interceptor";
  import { checkAndroidUpdate } from "$lib/android-update";
  import { purgeTauriServiceWorker } from "$lib/pwa";
  import { isTauri, isAndroid, openExternal } from "$lib/external-open";
  import { toast } from "svelte-sonner";
  import ConsentGate from "$lib/common/ConsentGate.svelte";
  import Sidebar from "$lib/layout/Sidebar.svelte";
  import Topbar from "$lib/layout/Topbar.svelte";
  import CommandPalette from "$lib/common/CommandPalette.svelte";
  import BackToTop from "$lib/common/BackToTop.svelte";
  // ?url so Vite returns the fingerprinted path. A hand-typed content hash
  // stops matching the moment the font or the bundler changes, and a preload
  // that 404s is worse than no preload - the browser still pays for it.
  import displayFont from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url";
  import bodyFont from "@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?url";

  let { children }: { children: Snippet } = $props();

  let menuOpen = $state(false);
  // Module-level would leak across HMR reloads in dev; per-instance is enough
  // because the layout mounts once.
  let updateChecked = false;
  let main: HTMLElement | undefined = $state();

  // Chrome-less routes: the introduction and the error pages stand alone, with
  // no sidebar or topbar around them.
  const bare = $derived(
    page.url.pathname === "/welcome" || page.url.pathname.startsWith("/error"),
  );

  /**
   * NOTHING gates the markup.
   *
   * An earlier version wrapped everything in `{#if ready}`, set from onMount.
   * onMount does not run during prerender, so every prerendered page contained
   * an empty body - 296 bytes of comments - and the entire SEO reason for
   * prerendering was gone. Measured, not theorised: dist/legal/tos.html had no
   * <h1>, no <h2> and no article text at all.
   *
   * It renders immediately instead, which is safe because `en` is statically
   * bundled as the i18n fallback: t() returns real strings from the first
   * render, and a Vietnamese visitor's bundle swaps in reactively a moment
   * later. The cost is one frame of English for vi readers; the alternative
   * was a blank page for crawlers.
   */
  onMount(() => {
    // Everything here touches localStorage or matchMedia and therefore cannot
    // run during prerender. The URL upgrade goes first, before the router
    // settles on a route.
    upgradeLegacyHashUrl();
    // Straight after the URL upgrade and before anything renders off the
    // route: both hosts answer an unmatched path with the PRERENDERED
    // dashboard, so /games/730 hydrates as "/" unless this corrects it.
    recoverFallbackRoute(page.route.id);
    theme.hydrate();
    consent.hydrate();
    welcome.hydrate();
    void i18n.init();

    // Tauri only. The webview blocks window.open() and target="_blank" to
    // external http(s), so without this every plain external <a> in the app
    // dead-clicks in the packaged builds. One capture-phase listener covers
    // them all. No-op on the web.
    installExternalLinkInterceptor();

    // Tauri only, and a one-time migration for anyone upgrading from a
    // build that shipped a service worker: one registered at
    // tauri.localhost can never update, so it would serve that build's
    // precache for the life of the install.
    void purgeTauriServiceWorker();

    // Android has no native Tauri updater (the plugin is desktop-only), so the
    // APK checks GitHub Releases itself, once per session. Best-effort: a
    // network error or a rate limit stays silent, because this is a nicety and
    // not a critical path.
    if (isTauri() && isAndroid() && !updateChecked) {
      updateChecked = true;
      void checkAndroidUpdate()
        .then((update) => {
          if (!update) return;
          toast.info(i18n.t("appUpdate.available", { version: update.version }), {
            description: i18n.t("appUpdate.body"),
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: i18n.t("appUpdate.download"),
              onClick: () => void openExternal(update.url),
            },
          });
        })
        .catch(() => {
          /* silent by design */
        });
    }

    return installPaletteShortcut();
  });

  // The ~6 MB catalogue fetch waits for consent: someone who declines should
  // never have caused the download.
  $effect(() => {
    if (consent.accepted) void games.load();
  });

  // Close the mobile drawer on navigation, or it stays open over the new page.
  $effect(() => {
    void page.url.pathname;
    menuOpen = false;
  });
</script>

<svelte:head>
  <!-- Only the two faces that appear above the fold. The other subsets are
       gated by unicode-range and must NOT be preloaded, or every visitor
       downloads a script they cannot read. crossorigin is required even
       same-origin, or the preload is fetched twice. -->
  <link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href={displayFont} />
  <link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href={bodyFont} />
</svelte:head>

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
      <div class="fixed inset-0 z-40 bg-black/60 lg:hidden" onclick={() => (menuOpen = false)}></div>
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

<!-- An OVERLAY, not a replacement for the page.
     It used to return children-or-gate, which meant every prerendered page's
     HTML was the consent dialog instead of its content. As an overlay the
     markup a crawler sees is the real page, and a visitor still cannot use the
     site until they accept. -->
<ConsentGate />

<!-- theme, not a hardcoded "dark": main.tsx pinned the Toaster to dark while
     the rest of the app had a working light mode, so every toast was a dark
     card on a white page. -->
<Toaster theme={theme.resolved} position="bottom-right" richColors closeButton />
