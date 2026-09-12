<script lang="ts">
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import { i18n } from "../i18n.svelte";
  import { cn } from "../utils";

  // The scroll container is <main>, not the window: the shell is a fixed-height
  // flex layout and the page itself never scrolls.
  let { scroller, threshold = 400 }: { scroller?: HTMLElement; threshold?: number } = $props();

  let visible = $state(false);

  $effect(() => {
    const el = scroller;
    if (!el) return;
    const onScroll = () => (visible = el.scrollTop > threshold);
    onScroll();
    // passive: this listener only reads scrollTop, and a non-passive scroll
    // listener blocks the compositor.
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  });
</script>

<button
  type="button"
  aria-label={i18n.t("common.backToTop")}
  onclick={() => scroller?.scrollTo({ top: 0, behavior: "smooth" })}
  class={cn(
    "fixed bottom-4 right-4 z-20 grid size-10 place-items-center rounded-full border",
    "bg-card text-muted-foreground shadow-lg transition-all hover:text-foreground",
    visible ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0",
  )}
>
  <ArrowUp class="size-4" />
</button>
