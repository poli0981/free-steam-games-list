<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "../utils";

  type Props = {
    class?: string;
    title?: string;
    /** Rendered before the title, e.g. an icon. */
    icon?: Snippet;
    description?: string;
    header?: Snippet;
    children: Snippet;
  } & Omit<HTMLAttributes<HTMLDivElement>, "class" | "title">;

  let { class: className, title, icon, description, header, children, ...rest }: Props =
    $props();
</script>

<div
  class={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}
  {...rest}
>
  {#if title || header || description}
    <div class="flex flex-col space-y-1.5 p-5 pb-3">
      {#if header}
        {@render header()}
      {:else}
        <h3 class="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
          {#if icon}{@render icon()}{/if}
          {title}
        </h3>
        {#if description}
          <p class="text-sm text-muted-foreground">{description}</p>
        {/if}
      {/if}
    </div>
    <div class="p-5 pt-0">{@render children()}</div>
  {:else}
    <div class="p-5">{@render children()}</div>
  {/if}
</div>
