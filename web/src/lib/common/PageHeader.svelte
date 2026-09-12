<script lang="ts">
  import type { Snippet } from "svelte";

  // One place decides how a page title looks, so the display face and the
  // spacing cannot drift across 20-odd pages the way they had.
  let {
    title,
    subtitle,
    actions,
  }: { title: string; subtitle?: string; actions?: Snippet } = $props();
</script>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
  <div class="min-w-0">
    <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
    {#if subtitle}
      <p class="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
    {/if}
  </div>
  {#if actions}
    <div class="flex shrink-0 flex-wrap items-center gap-2">{@render actions()}</div>
  {/if}
</div>
