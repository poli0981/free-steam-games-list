<script lang="ts">
  import type { Component, Snippet } from "svelte";

  type Props = { icon: Component<{ class?: string }>; title: string; children?: Snippet };
  let { icon: Icon, title, children }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
  <div class="rounded-full bg-muted p-3 text-muted-foreground"><Icon class="size-5" /></div>
  <p class="font-medium">{title}</p>
  {#if children}
    <div class="max-w-md text-sm text-muted-foreground">{@render children()}</div>
  {/if}
</div>
