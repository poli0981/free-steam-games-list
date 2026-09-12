<script lang="ts">
  import type { EChartsCoreOption } from "echarts/core";
  import type { ECharts } from "echarts/core";
  import { chartTheme } from "../chart-theme";
  import { theme } from "../prefs.svelte";
  import { cn } from "../utils";

  let {
    option,
    height = 360,
    class: className,
    /** Accessible summary. A canvas is opaque to a screen reader, so without
     *  one the chart is simply absent from the accessibility tree. */
    label,
  }: {
    option: EChartsCoreOption;
    height?: number | string;
    class?: string;
    label: string;
  } = $props();

  let host: HTMLDivElement | undefined = $state();
  // $state, not a plain `let`. The init effect and the setOption effect are
  // separate (so changing `option` updates the chart instead of recreating it),
  // and a non-reactive `chart` meant setOption ran once while it was still
  // undefined and then never re-ran - echarts initialised, created its inner
  // container, and painted no canvas at all. That looks exactly like the
  // unregistered-theme failure described in echarts.ts, which is why it is
  // worth naming here.
  let chart = $state<ECharts | undefined>(undefined);
  let visible = $state(false);
  let mod: typeof import("./echarts") | undefined = $state();

  /**
   * Nothing is loaded or initialised until the chart is near the viewport.
   *
   * The React version lazy-loaded the echarts MODULE but then initialised every
   * chart on the page at once, which is where the reported
   * `[Violation] 'setTimeout' handler took 122ms` came from: a page with four
   * charts paid four inits in one frame, below-the-fold ones included.
   * IntersectionObserver moves that cost to the moment a chart is actually
   * about to be seen, and spreads it across separate frames.
   */
  $effect(() => {
    const el = host;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visible = true;
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  });

  $effect(() => {
    if (!visible || mod) return;
    void import("./echarts").then((m) => (mod = m));
  });

  $effect(() => {
    const el = host;
    const m = mod;
    if (!el || !m) return;

    // No theme argument. See the note in echarts.ts: under echarts 6 an
    // unregistered theme name silently stops every series painting.
    chart = m.echarts.init(el, undefined, { renderer: "canvas" });

    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart?.dispose();
      chart = undefined;
    };
  });

  // Re-reads the CSS custom properties, so a light/dark switch repaints the
  // chart rather than leaving it in the old palette.
  $effect(() => {
    void theme.resolved;
    const c = chart;
    if (!c) return;

    const t = chartTheme();
    c.setOption(
      {
        color: t.series,
        ...(option as Record<string, unknown>),
        tooltip: {
          backgroundColor: t.card,
          borderColor: t.border,
          borderWidth: 1,
          textStyle: { color: t.text, fontSize: 12 },
          ...((option as Record<string, unknown>).tooltip as object | undefined),
        },
        backgroundColor: "transparent",
        textStyle: {
          // Inherit the real body face rather than the hardcoded
          // "Inter, system-ui, sans-serif" the React version carried - Inter
          // was never loaded, so charts and page text disagreed.
          fontFamily: getComputedStyle(document.documentElement)
            .getPropertyValue("--font-sans")
            .trim(),
          color: t.mutedText,
        },
      },
      { notMerge: true, lazyUpdate: true },
    );
  });
</script>

<div
  bind:this={host}
  class={cn("w-full", className)}
  style:height={typeof height === "number" ? `${height}px` : height}
  role="img"
  aria-label={label}
>
  {#if !visible || !mod}
    <!-- Same footprint as the chart, so nothing below it jumps when it
         initialises. -->
    <div class="size-full animate-pulse rounded-md bg-muted/40"></div>
  {/if}
</div>
