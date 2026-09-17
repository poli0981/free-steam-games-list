<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../../src/lib/utils";

  let { children, class: className }: { children: Snippet; class?: string } = $props();
</script>

<kbd
  class={cn(
    "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-muted px-1 font-mono text-[11px] leading-none text-muted-foreground",
    className,
  )}>{@render children()}</kbd
>
