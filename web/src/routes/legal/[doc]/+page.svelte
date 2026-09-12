<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import { i18n } from "$lib/i18n.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import type { PageData } from "./$types";
  import Seo from "$lib/common/Seo.svelte";

  let { data }: { data: PageData } = $props();

  const t = i18n.t;
</script>

<Seo title={data.meta.label} description={data.meta.hint} type="article" />

<div class="mx-auto max-w-3xl">
  <a
    href="/about"
    class="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
  >
    <ArrowLeft class="size-3.5" />
    {t("nav.about")}
  </a>

  <PageHeader title={data.heading ?? data.meta.label} subtitle={data.meta.hint}>
    {#snippet actions()}
      <a
        href={data.sourceUrl}
        target="_blank"
        rel="noreferrer"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs
               transition-colors hover:bg-accent"
      >
        <ExternalLink class="size-3.5" />
        {t("legal.viewSource")}
      </a>
    {/snippet}
  </PageHeader>

  <!-- Safe by construction: this HTML was produced by +page.server.ts at BUILD
       time from a file in this repository, through rehype-sanitize, and is
       baked into the prerendered page. No markdown is parsed in the browser. -->
  <article class="legal-prose">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html data.html}
  </article>

  <p class="mt-8 border-t pt-4 text-xs text-muted-foreground">{t("legal.lastCommitted")}</p>
</div>

<style>
  /* Typography for the rendered markdown.

     Plain CSS against the design tokens, not @apply: Tailwind 4 does not
     expose its utilities inside a component <style> without an explicit
     @reference, and utility classes cannot reach into {@html} output anyway.
     Pulling in @tailwindcss/typography for six documents would be a whole
     dependency for one page. */
  .legal-prose :global(h1) {
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 600;
    margin: 2rem 0 1rem;
  }
  .legal-prose :global(h2) {
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 600;
    margin: 2rem 0 0.75rem;
    padding-bottom: 0.375rem;
    border-bottom: 1px solid hsl(var(--border));
  }
  .legal-prose :global(h3) {
    font-size: 1rem;
    font-weight: 600;
    margin: 1.5rem 0 0.5rem;
  }
  .legal-prose :global(p),
  .legal-prose :global(li) {
    font-size: 0.875rem;
    line-height: 1.7;
    color: hsl(var(--muted-foreground));
  }
  .legal-prose :global(p) {
    margin: 0.75rem 0;
  }
  .legal-prose :global(ul),
  .legal-prose :global(ol) {
    margin: 0.75rem 0;
    padding-left: 1.25rem;
  }
  .legal-prose :global(ul) {
    list-style: disc;
  }
  .legal-prose :global(ol) {
    list-style: decimal;
  }
  .legal-prose :global(li) {
    margin: 0.375rem 0;
  }
  .legal-prose :global(a) {
    color: hsl(var(--primary));
    text-underline-offset: 2px;
  }
  .legal-prose :global(a:hover) {
    text-decoration: underline;
  }
  .legal-prose :global(code) {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: hsl(var(--muted));
    border-radius: calc(var(--radius) - 4px);
    padding: 0.1rem 0.3rem;
  }
  .legal-prose :global(pre) {
    margin: 1rem 0;
    overflow-x: auto;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius);
    background: hsl(var(--card));
    padding: 0.75rem;
    font-size: 0.75rem;
  }
  .legal-prose :global(pre code) {
    background: none;
    padding: 0;
  }
  .legal-prose :global(blockquote) {
    margin: 1rem 0;
    padding-left: 1rem;
    border-left: 2px solid hsl(var(--primary) / 0.4);
    font-style: italic;
    color: hsl(var(--muted-foreground));
  }
  /* Wide tables must scroll inside the article rather than widening the page. */
  .legal-prose :global(table) {
    margin: 1rem 0;
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    display: block;
    overflow-x: auto;
  }
  .legal-prose :global(th),
  .legal-prose :global(td) {
    border-bottom: 1px solid hsl(var(--border));
    padding: 0.375rem 0.5rem;
    text-align: left;
    vertical-align: top;
  }
  .legal-prose :global(th) {
    font-weight: 600;
    color: hsl(var(--foreground));
    white-space: nowrap;
  }
  .legal-prose :global(hr) {
    margin: 1.5rem 0;
    border: 0;
    border-top: 1px solid hsl(var(--border));
  }
  .legal-prose :global(strong) {
    font-weight: 600;
    color: hsl(var(--foreground));
  }
  .legal-prose :global(img) {
    max-width: 100%;
    height: auto;
  }
</style>
