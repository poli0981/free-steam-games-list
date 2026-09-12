<script lang="ts">
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { page } from "$app/state";
  import { consent } from "../prefs.svelte";
  import { CONSENT_DOCS, legalDocSlug } from "../legal";
  import { i18n } from "../i18n.svelte";
  import { isTauri } from "../external-open";
  import Button from "../ui/Button.svelte";

  const t = i18n.t;

  let checked = $state(false);
  let declined = $state(false);

  /**
   * The error system must reach the user even before consent: a chunk-load 503
   * after a mid-session deploy, or an /error/:code deep link, would otherwise
   * be swallowed behind the gate with no way to read it.
   *
   * ANY new route that must be reachable pre-consent has to join this check.
   */
  const isErrorRoute = $derived(page.url.pathname.startsWith("/error"));
  const open = $derived(!consent.accepted && !isErrorRoute);

  // No scroll lock on <body>. It would be dead code: the shell is a fixed-height
  // flex layout whose scroller is <main>, so body never scrolls in the first
  // place - measured, document.body.style.overflow stayed "visible" either way.
  // The overlay is a full-viewport `fixed inset-0` element with its own
  // overflow-auto, so wheel events over it never reach the page beneath.

  async function decline() {
    // Desktop: declining means you do not get the app, so quit it. On the web
    // there is nothing to quit, so show a blocking notice with a way back.
    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
        return;
      } catch (err) {
        console.error("ConsentGate: failed to close window", err);
      }
    }
    declined = true;
  }
</script>

{#if !open}
  <!-- nothing: the page underneath is already rendered -->
{:else if declined}
  <div class="fixed inset-0 z-[60] flex items-center justify-center overflow-auto bg-background/95 p-4 backdrop-blur-sm">
    <div class="w-full max-w-md rounded-lg border border-warning/40 bg-warning/5 p-8 text-center">
      <ShieldCheck class="mx-auto mb-4 size-10 text-warning" />
      <h1 class="mb-2 text-xl font-semibold">{t("consent.declinedTitle")}</h1>
      <p class="text-sm text-muted-foreground">{t("consent.declinedBody")}</p>
      <Button class="mt-6" variant="outline" onclick={() => (declined = false)}>
        {t("consent.back")}
      </Button>
    </div>
  </div>
{:else}
  <div class="fixed inset-0 z-[60] flex items-center justify-center overflow-auto bg-background/95 p-4 backdrop-blur-sm">
    <div class="w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl sm:p-8">
      <div class="mb-5 flex items-start gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <ScrollText class="size-5" />
        </span>
        <div>
          <h1 class="text-xl font-semibold">{t("consent.title")}</h1>
          <p class="mt-1 text-sm text-muted-foreground">{t("consent.intro")}</p>
        </div>
      </div>

      <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("consent.docsLabel")}
      </p>
      <ul class="mb-5 space-y-1.5">
        {#each CONSENT_DOCS as doc (doc.path)}
          <li>
            <!-- Real in-app routes. These used to be links that called
                 preventDefault() and bounced to /about, because /legal/* did
                 not exist. -->
            <a
              href="/legal/{legalDocSlug(doc.path)}"
              class="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm
                     transition-colors hover:border-border-strong hover:bg-accent"
            >
              <span class="min-w-0 flex-1 truncate font-medium">{doc.label}</span>
              <span class="hidden truncate text-xs text-muted-foreground sm:block">{doc.hint}</span>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
            </a>
          </li>
        {/each}
      </ul>

      <label class="mb-5 flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          bind:checked
          class="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
        />
        <span>{t("consent.checkboxLabel")}</span>
      </label>

      <div class="flex flex-wrap gap-2">
        <Button disabled={!checked} onclick={() => consent.accept()}>
          {t("consent.continue")}
        </Button>
        <Button variant="ghost" onclick={decline}>{t("consent.decline")}</Button>
      </div>
    </div>
  </div>
{/if}
