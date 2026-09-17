<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Button from "../../../src/lib/ui/Button.svelte";
  import { rangeLabel } from "../lib/format";

  type Props = {
    offset: number;
    limit: number;
    total: number;
    count: number;
    disabled?: boolean;
    sizes?: number[];
    onpage: (offset: number) => void;
    onsize?: (size: number) => void;
  };

  let { offset, limit, total, count, disabled = false, sizes = [25, 50, 100, 200], onpage, onsize }: Props = $props();

  const page = $derived(Math.floor(offset / limit) + 1);
  const pages = $derived(Math.max(1, Math.ceil(total / limit)));
</script>

<nav class="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pagination">
  <p class="tnum text-muted-foreground" aria-live="polite">{rangeLabel(offset, count, total)}</p>
  <div class="flex items-center gap-2">
    {#if onsize}
      <label class="flex items-center gap-2 text-muted-foreground">
        <span class="hidden sm:inline">Rows</span>
        <select
          class="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          value={limit}
          {disabled}
          onchange={(e) => onsize(Number(e.currentTarget.value))}
        >
          {#each sizes as size (size)}
            <option value={size}>{size}</option>
          {/each}
        </select>
      </label>
    {/if}
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || offset === 0}
      aria-label="Previous page"
      onclick={() => onpage(Math.max(0, offset - limit))}
    >
      <ChevronLeft class="size-4" />
    </Button>
    <span class="tnum min-w-20 text-center text-muted-foreground">Page {page} of {pages}</span>
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || offset + limit >= total}
      aria-label="Next page"
      onclick={() => onpage(offset + limit)}
    >
      <ChevronRight class="size-4" />
    </Button>
  </div>
</nav>
