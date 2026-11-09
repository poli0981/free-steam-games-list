<script lang="ts">
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import FileDiff from "@lucide/svelte/icons/file-diff";
  import House from "@lucide/svelte/icons/house";
  import { page } from "$app/state";
  import { consent } from "../consent.svelte";
  import { CONSENT_DOCS, legalDocSlug } from "../legal";
  import { diffHunks, formatHunk } from "../diff";
  import { i18n } from "../i18n.svelte";
  import { isTauri } from "../external-open";
  import { isUngatedPath } from "../gates";
  import { closeTab, leaveSite } from "../leave-site";
  import { pwa } from "../pwa-state.svelte";
  import { overlays, focusOnMount } from "../overlays.svelte";
  import Button from "../ui/Button.svelte";

  const t = i18n.t;

  let checked = $state(false);
  let declined = $state(false);

  // The apps have no browser to go back in, and Decline already quits them.
  // Settled when the component is created in the page; the server render that
  // reads it never shows the gate (`open` waits for consent.hydrated).
  const canLeave = !isTauri();

  /** "nowhere": the site is the first page in this tab, so the only way out is
   *  closing it. "refused": the browser would not let the page do that either. */
  let leaving = $state<"idle" | "nowhere" | "refused">("idle");

  // /error/* and /legal/* stay readable before consent; lib/gates.ts says why,
  // and HumanCheck.svelte exempts exactly the same routes.
  const exempt = $derived(isUngatedPath(page.url.pathname));

  // `hydrated` first: during prerender and until storage has been read,
  // `accepted` is false for everyone, and rendering the gate then put the whole
  // dialog into every page's HTML.
  const open = $derived(consent.hydrated && !consent.accepted && !exempt);

  // The layout makes the page behind inert while this is open (overlays.svelte.ts).
  $effect(() => {
    overlays.consent = open;
    return () => {
      overlays.consent = false;
    };
  });

  /**
   * REVIEW mode: some documents changed since this reader accepted them, and
   * only those are shown, as a diff. Before per-document hashing the only
   * lever was TERMS_VERSION, which re-prompted everyone with all six documents
   * and no indication of what was different.
   */
  const reviewing = $derived(consent.changed.length > 0);
  const docs = $derived(
    reviewing ? CONSENT_DOCS.filter((d) => consent.changed.includes(legalDocSlug(d.path))) : CONSENT_DOCS,
  );

  /**
   * The raw markdown of the six documents, ~25 KB, in a chunk of its own
   * (virtual:legal-sources, built by build/legal-versions.ts). Imported here
   * and nowhere else, so a page load that never opens this gate never fetches
   * it. Needed twice over: to diff against the accepted copy, and to snapshot
   * what is being accepted now so the NEXT change can be shown this way.
   */
  let sources = $state<Record<string, string> | null>(null);
  let sourcesPromise: Promise<Record<string, string> | undefined> | null = null;

  function loadSources(): Promise<Record<string, string> | undefined> {
    sourcesPromise ??= import("virtual:legal-sources")
      .then((m) => {
        sources = m.LEGAL_SOURCES;
        return m.LEGAL_SOURCES;
      })
      .catch((err) => {
        // Not fatal, and deliberately not a blocker on accepting: without it
        // the next change simply asks for a full read instead of a diff.
        console.warn("ConsentGate: legal sources unavailable", err);
        return undefined;
      });
    return sourcesPromise;
  }

  $effect(() => {
    if (open) void loadSources();
  });

  /** The diff for one document, or null when there is nothing to compare
   *  against - storage cleared, or an acceptance older than the snapshot. */
  function changesFor(slug: string) {
    const before = consent.acceptedText(slug);
    const after = sources?.[slug];
    if (before === null || after === undefined) return null;
    return diffHunks(before, after);
  }

  async function accept() {
    // Await rather than fire-and-forget: the import is a local chunk, and
    // accepting a millisecond before it resolves would silently cost the
    // snapshot this whole feature runs on.
    consent.accept(await loadSources());
  }

  // No scroll lock on <body>. It would be dead code: the shell is a fixed-height
  // flex layout whose scroller is <main>, so body never scrolls in the first
  // place - measured, document.body.style.overflow stayed "visible" either way.
  // The overlay is a full-viewport `fixed inset-0` element with its own
  // overflow-auto, so wheel events over it never reach the page beneath.

  async function decline() {
    // Apps: declining means you do not get the app, so quit it - with exit()
    // from the app module (capability core:app:allow-exit), not the window's
    // close(). On Android close() does nothing at all: tao reports a destroyed
    // window only from the Activity's onDestroy, so Decline sat there dead.
    // exit() finishes the activity there (back to the home screen) and ends
    // the process on the desktop. On the web there is nothing to quit, so show
    // a blocking notice with a way back.
    if (isTauri()) {
      try {
        const { exit } = await import("@tauri-apps/api/app");
        await exit(0);
        // exit() can resolve before Android's closing transition has run.
        // Still here a while later means it did not happen: say so.
        setTimeout(() => (declined = true), 2000);
        return;
      } catch (err) {
        console.error("ConsentGate: failed to quit the app", err);
      }
    }
    declined = true;
  }

  // Web only (canLeave): back to the page before the site; lib/leave-site.ts
  // has why that is the nearest a page can get to the browser's start page.
  function leave() {
    leaveSite(window, () => (leaving = "nowhere"));
  }

  function closeThisTab() {
    if (!closeTab(window)) leaving = "refused";
  }
</script>

<!-- The cards below centre with m-auto, not items-center: auto margins centre
     a card that fits and collapse for one that does not, so on a short phone
     the card scrolls from its top instead of losing it above the screen.
     p-safe-or-4 keeps it clear of the Android system bars. -->
{#if !open}
  <!-- nothing: the page underneath is already rendered -->
{:else if leaving !== "idle"}
  <div class="fixed inset-0 z-[60] flex overflow-auto bg-background/95 p-safe-or-4 backdrop-blur-sm">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      tabindex="-1"
      {@attach focusOnMount}
      class="m-auto w-full max-w-md rounded-lg border bg-card p-8 text-center focus:outline-none"
    >
      <House class="mx-auto mb-4 size-10 text-muted-foreground" />
      <h2 id="consent-title" class="mb-2 text-xl font-semibold">{t("consent.leaveNowhereTitle")}</h2>
      <p role="status" class="text-sm text-muted-foreground">
        {leaving === "refused" ? t("consent.leaveRefused") : t("consent.leaveNowhereBody")}
      </p>
      <div class="mt-6 flex flex-wrap justify-center gap-2">
        {#if leaving === "nowhere"}
          <Button onclick={closeThisTab}>
            {pwa.standalone ? t("consent.leaveCloseWindow") : t("consent.leaveCloseTab")}
          </Button>
        {/if}
        <!-- Back to whichever card was showing: the terms, or the declined notice. -->
        <Button variant="outline" onclick={() => (leaving = "idle")}>{t("consent.back")}</Button>
      </div>
    </div>
  </div>
{:else if declined}
  <div class="fixed inset-0 z-[60] flex overflow-auto bg-background/95 p-safe-or-4 backdrop-blur-sm">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      tabindex="-1"
      {@attach focusOnMount}
      class="m-auto w-full max-w-md rounded-lg border border-warning/40 bg-warning/5 p-8 text-center focus:outline-none"
    >
      <ShieldCheck class="mx-auto mb-4 size-10 text-warning" />
      <h2 id="consent-title" class="mb-2 text-xl font-semibold">{t("consent.declinedTitle")}</h2>
      <p class="text-sm text-muted-foreground">{t("consent.declinedBody")}</p>
      <div class="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="outline" onclick={() => (declined = false)}>
          {t("consent.back")}
        </Button>
        {#if canLeave}
          <Button variant="ghost" onclick={leave}>
            <House class="size-4" />
            {t("consent.leave")}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <div class="fixed inset-0 z-[60] flex overflow-auto bg-background/95 p-safe-or-4 backdrop-blur-sm">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      tabindex="-1"
      {@attach focusOnMount}
      class="m-auto w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl focus:outline-none sm:p-8"
    >
      <div class="mb-5 flex items-start gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          {#if reviewing}
            <FileDiff class="size-5" />
          {:else}
            <ScrollText class="size-5" />
          {/if}
        </span>
        <div>
          <h2 id="consent-title" class="text-xl font-semibold">{reviewing ? t("consent.changedTitle") : t("consent.title")}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {reviewing ? t("consent.changedIntro") : t("consent.intro")}
          </p>
        </div>
      </div>

      <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {reviewing ? t("consent.changedDocsLabel") : t("consent.docsLabel")}
      </p>
      <ul class="mb-5 space-y-1.5">
        {#each docs as doc (doc.path)}
          {@const slug = legalDocSlug(doc.path)}
          <li>
            <!-- Real in-app routes. These used to be links that called
                 preventDefault() and bounced to /about, because /legal/* did
                 not exist. -->
            <a
              href="/legal/{slug}"
              class="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm
                     transition-colors hover:border-border-strong hover:bg-accent"
            >
              <span class="min-w-0 flex-1 truncate font-medium">{t(doc.label)}</span>
              <!-- min-w-0 so a long hint SHRINKS instead of pushing the
                   label out of the row: a flex item defaults to
                   min-width:auto, so without it the hint claims its full
                   content width and the flex-1 label collapses to nothing.
                   Measured - a longer privacy hint erased "Privacy Policy". -->
              <span class="hidden min-w-0 shrink truncate text-xs text-muted-foreground sm:block sm:max-w-[55%]">{t(doc.hint)}</span>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
            </a>

            {#if reviewing}
              {@const hunks = changesFor(slug)}
              {#if hunks === null}
                <p class="mt-1.5 px-3 text-xs text-muted-foreground">{t("consent.noComparison")}</p>
              {:else if hunks.length === 0}
                <p class="mt-1.5 px-3 text-xs text-muted-foreground">{t("consent.formattingOnly")}</p>
              {:else}
                <details class="mt-1.5">
                  <summary class="cursor-pointer px-3 text-xs text-primary">{t("consent.showChanges")}</summary>
                  <p class="mt-1 px-3 text-xs text-muted-foreground">{t("consent.diffLegend")}</p>
                  <!--
                    Plain text in a <pre>, never {@html}. These are repository
                    documents, but rendering markup at the moment someone is
                    asked to agree to something is not a thing to do.
                  -->
                  {#each hunks as hunk (hunk.start)}
                    <pre
                      class="mt-1 max-h-64 overflow-auto rounded-md border bg-background px-3 py-2
                             text-xs leading-relaxed whitespace-pre-wrap">{formatHunk(hunk)}</pre>
                  {/each}
                </details>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>

      <label class="mb-5 flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          bind:checked
          class="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
        />
        <span>{reviewing ? t("consent.changedCheckboxLabel") : t("consent.checkboxLabel")}</span>
      </label>

      <div class="flex flex-wrap gap-2">
        <Button disabled={!checked} onclick={accept}>
          {reviewing ? t("consent.acceptChanges") : t("consent.continue")}
        </Button>
        <Button variant="ghost" onclick={decline}>{t("consent.decline")}</Button>
        {#if canLeave}
          <Button variant="ghost" class="sm:ml-auto" onclick={leave}>
            <House class="size-4" />
            {t("consent.leave")}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/if}
