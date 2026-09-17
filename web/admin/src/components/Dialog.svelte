<!--
  A modal on the native <dialog>. showModal() gives the focus trap, inert
  background, top layer and Escape for free, which is everything bits-ui was
  providing - without a dependency or a portal.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import X from "@lucide/svelte/icons/x";
  import { cn } from "../../../src/lib/utils";

  type Props = {
    open: boolean;
    title: string;
    description?: string;
    size?: "sm" | "md" | "lg" | "xl";
    /** False while a request is running: Escape and the backdrop do nothing. */
    dismissable?: boolean;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  };

  let {
    open = $bindable(),
    title,
    description,
    size = "md",
    dismissable = true,
    onclose,
    children,
    footer,
  }: Props = $props();

  const id = $props.id();
  let dialog = $state<HTMLDialogElement>();

  const WIDTH = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" } as const;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal() focuses the first focusable element, which is the close
      // button. A dialog that asks for input marks the field it wants instead.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) dialog.close();
  });

  function close() {
    if (dismissable) dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="{id}-title"
  aria-describedby={description ? `${id}-desc` : undefined}
  class={cn(
    "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-hidden rounded-lg border border-border bg-card p-0 text-card-foreground shadow-2xl",
    "backdrop:bg-black/60 backdrop:backdrop-blur-[2px]",
    WIDTH[size],
  )}
  oncancel={(e) => {
    if (!dismissable) e.preventDefault();
  }}
  onclose={() => {
    open = false;
    onclose?.();
  }}
  onclick={(e) => {
    // The dialog element itself is only ever the target for a click on the
    // backdrop: all of its content sits inside the wrapper below.
    if (e.target === dialog) close();
  }}
>
  {#if open}
    <div class="flex max-h-[calc(100dvh-2rem)] flex-col">
      <header class="flex items-start gap-3 border-b border-border px-5 py-4">
        <div class="min-w-0 flex-1">
          <h2 id="{id}-title" class="text-base font-semibold leading-6">{title}</h2>
          {#if description}
            <p id="{id}-desc" class="mt-0.5 text-sm text-muted-foreground">{description}</p>
          {/if}
        </div>
        <button
          type="button"
          class="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          aria-label="Close"
          disabled={!dismissable}
          onclick={close}
        >
          <X class="size-4" />
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {@render children()}
      </div>
      {#if footer}
        <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          {@render footer()}
        </footer>
      {/if}
    </div>
  {/if}
</dialog>
