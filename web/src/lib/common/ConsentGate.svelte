<script lang="ts">
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import FileDiff from "@lucide/svelte/icons/file-diff";
  import { page } from "$app/state";
  import { consent } from "../consent.svelte";
  import { CONSENT_DOCS, legalDocSlug } from "../legal";
  import { diffHunks, formatHunk } from "../diff";
  import { i18n } from "../i18n.svelte";
  import { isTauri } from "../external-open";
  import Button from "../ui/Button.svelte";

  const t = i18n.t;

  let checked = $state(false);
  let declined = $state(false);

  /**
   * Routes that must be readable BEFORE consent:
   *
   *   - /error/*: a chunk-load 503 after a mid-session deploy, or an
   *     /error/:code deep link, would otherwise be swallowed behind the gate.
   *   - /legal/*: the gate links to these documents and asks the reader to
   *     accept them. Covering them with the same overlay made the terms
   *     impossible to read before agreeing to them.
   *
   * ANY new route that must be reachable pre-consent has to join this check.
   */
  const PRE_CONSENT = /^\/(error|legal)(\/|$)/;
  const exempt = $derived(PRE_CONSENT.test(page.url.pathname));

  // `hydrated` first: during prerender and until storage has been read,
  // `accepted` is false for everyone, and rendering the gate then put the whole
  // dialog into every page's HTML.
  const open = $derived(consent.hydrated && !consent.accepted && !exempt);

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
          {#if reviewing}
            <FileDiff class="size-5" />
          {:else}
            <ScrollText class="size-5" />
          {/if}
        </span>
        <div>
          <h1 class="text-xl font-semibold">{reviewing ? t("consent.changedTitle") : t("consent.title")}</h1>
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
      </div>
    </div>
  </div>
{/if}
