<!-- Steam capsule art. A missing or refused image becomes a quiet placeholder
     instead of the browser's broken-image glyph. -->
<script lang="ts">
  import Gamepad2 from "@lucide/svelte/icons/gamepad-2";
  import { cn } from "../../../src/lib/utils";

  type Props = { src: string | null | undefined; class?: string; lazy?: boolean };
  let { src, class: className, lazy = true }: Props = $props();

  // Keyed on the URL, so a row reused for another game tries its image afresh.
  let failedSrc = $state<string | null>(null);
  const failed = $derived(!!src && failedSrc === src);
</script>

{#if src && !failed}
  <img
    {src}
    alt=""
    loading={lazy ? "lazy" : "eager"}
    referrerpolicy="no-referrer"
    class={cn("rounded border border-border bg-muted object-cover", className)}
    onerror={() => (failedSrc = src ?? null)}
  />
{:else}
  <span class={cn("grid place-items-center rounded border border-border bg-muted text-muted-foreground", className)} aria-hidden="true">
    <Gamepad2 class="size-4 opacity-60" />
  </span>
{/if}
