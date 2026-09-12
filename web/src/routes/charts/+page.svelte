<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { CHART_PAGES } from "$lib/chart-nav";
  import { i18n } from "$lib/i18n.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";

  const t = i18n.t;
</script>

<svelte:head>
  <title>{t("charts.indexTitle")} · Steam F2P Tracker</title>
  <meta name="description" content={t("charts.indexSubtitle")} />
</svelte:head>

<PageHeader title={t("charts.indexTitle")} subtitle={t("charts.indexSubtitle")} />

<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
  {#each CHART_PAGES as c (c.to)}
    <a
      href={c.to}
      class="group flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors
             hover:border-border-strong hover:bg-accent"
    >
      <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
        <c.icon class="size-4" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block font-medium">{t(c.i18n)}</span>
        <span class="mt-0.5 block text-sm text-muted-foreground">{t(c.desc)}</span>
      </span>
      <ArrowRight
        class="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </a>
  {/each}
</div>
