<script lang="ts">
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";
  import Badge from "../ui/Badge.svelte";
  import { i18n } from "../i18n.svelte";

  /**
   * An anti-cheat product, with kernel level shown by more than colour.
   *
   * Kernel-level anti-cheat used to differ from the rest only by the badge's
   * colour (red against amber), which says nothing to a colour-blind reader or
   * a screen reader. The shield icon is the visible cue, and the words are
   * always there: visible where there is room (`labelled`, the game page),
   * read by screen readers only in the table, the cards and /random, where a
   * long product name already fills the badge.
   *
   * `kernel` is `is_kernel_ac`, which is tri-state: null means nobody has
   * checked, and that is not shown as kernel-level.
   */
  let {
    name,
    kernel = false,
    labelled = false,
    class: className,
  }: { name: string; kernel?: boolean | null; labelled?: boolean; class?: string } = $props();

  const t = i18n.t;
</script>

<Badge variant={kernel ? "destructive" : "warning"} class={className}>
  {#if kernel}<ShieldAlert class="mr-1 inline size-3 shrink-0 align-[-0.125em]" />{/if}{name}{#if kernel && labelled}<span>&nbsp;· {t("charts.acLevel.kernel")}</span>{:else if kernel}<span class="sr-only">&nbsp;({t("charts.acLevel.kernel")})</span>{/if}
</Badge>
