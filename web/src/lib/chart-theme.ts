/**
 * Chart colours derived from the design tokens.
 *
 * Charts previously hardcoded ~18 hex values, so any palette change left them
 * clashing with the rest of the UI and they never responded to the light/dark
 * switch. Reading the CSS custom properties at call time keeps them in step
 * with whatever theme is active.
 *
 * Colours that encode MEANING rather than theme — review-score green/amber/red,
 * platform brand colours — deliberately stay where they are. Those are data
 * semantics, not decoration.
 *
 * EVERY colour handed to ECharts must be one zrender can parse, and zrender's
 * parser is older than CSS Color 4: it splits `hsl()` arguments on COMMAS.
 *
 *   - `hsl(38 94% 60%)` (space-separated) paints on the canvas, because the
 *     browser parses it - but zrender cannot, so every hover state derived from
 *     it (`liftColor`) comes back `undefined` and the hovered bar, slice or
 *     treemap tile loses its fill entirely. That was the blank "Card Game" tile
 *     on /charts/genres.
 *   - `hsl(var(--success))` is not a colour at all to a canvas. It never
 *     painted.
 *
 * So tokens are converted with hslFromChannels(), and chart-colors.test.ts
 * runs zrender's own parser over every value this file can return.
 */
import { theme as themePref } from "./prefs.svelte";

/**
 * Bare HSL channels, as the tokens store them ("38 94% 60%", optionally
 * "38 94% 60% / 0.5"), to the comma form zrender understands. Returns null for
 * anything that is not channel syntax, so a malformed token falls back rather
 * than producing a colour nothing can parse.
 */
export function hslFromChannels(raw: string): string | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)(?:deg)?\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*(?:\/\s*(\d+(?:\.\d+)?%?))?\s*$/.exec(
    raw,
  );
  if (!m) return null;
  const [, h, s, l, a] = m;
  if (a === undefined) return `hsl(${h}, ${s}%, ${l}%)`;
  const alpha = a.endsWith("%") ? String(parseFloat(a) / 100) : a;
  return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
}

function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // Tokens are stored as bare HSL channels ("204 92% 56%") so Tailwind can
  // apply opacity modifiers to them.
  return (raw && hslFromChannels(raw)) || fallback;
}

export interface ChartTheme {
  text: string;
  mutedText: string;
  grid: string;
  border: string;
  card: string;
  /** Meaning-bearing tones: good / caution / bad / neutral information. */
  success: string;
  warning: string;
  destructive: string;
  info: string;
  series: string[];
}

/** The fallbacks, exported so the colour test can prove they parse too. */
export const CHART_FALLBACKS = {
  primary: "hsl(34, 96%, 58%)",
  text: "hsl(40, 20%, 95%)",
  mutedText: "hsl(38, 10%, 65%)",
  grid: "hsl(30, 10%, 19%)",
  border: "hsl(30, 9%, 29%)",
  card: "hsl(30, 13%, 10%)",
  success: "hsl(152, 56%, 50%)",
  warning: "hsl(38, 94%, 60%)",
  destructive: "hsl(358, 72%, 62%)",
  info: "hsl(204, 88%, 62%)",
} as const;

/** Categorical colours after the three token-derived ones. */
export const EXTRA_SERIES = [
  "hsl(268, 84%, 68%)",
  "hsl(330, 78%, 62%)",
  "hsl(174, 66%, 46%)",
  "hsl(22, 88%, 60%)",
  "hsl(224, 70%, 68%)",
] as const;

/**
 * Resolve once per chart render — cheap, and picks up a theme switch.
 *
 * Reading `theme.resolved` is what makes that true: every page builds its
 * option inside `$derived.by`, and this read registers the theme as a
 * dependency of that derivation. Without it the axis and grid colours baked
 * into the option stayed in the previous palette until the page remounted.
 */
export function chartTheme(): ChartTheme {
  void themePref.resolved;
  const primary = token("--primary", CHART_FALLBACKS.primary);
  const success = token("--success", CHART_FALLBACKS.success);
  const warning = token("--warning", CHART_FALLBACKS.warning);
  return {
    text: token("--card-foreground", CHART_FALLBACKS.text),
    mutedText: token("--muted-foreground", CHART_FALLBACKS.mutedText),
    grid: token("--border", CHART_FALLBACKS.grid),
    border: token("--border-strong", CHART_FALLBACKS.border),
    card: token("--card", CHART_FALLBACKS.card),
    success,
    warning,
    destructive: token("--destructive", CHART_FALLBACKS.destructive),
    info: token("--info", CHART_FALLBACKS.info),
    // A categorical ramp that starts at the brand primary and stays
    // distinguishable in both themes.
    series: [primary, success, warning, ...EXTRA_SERIES],
  };
}

/**
 * Grid layout for a cartesian chart.
 *
 * NOT `containLabel: true`. In echarts 6 that is shorthand for
 * `{outerBoundsMode: "same", outerBoundsContain: "axisLabel"}`, which reserves
 * room for tick labels but not for AXIS NAMES - so the /stats scatter lost the
 * top of its y-axis name and most of its x-axis name. "all" includes both.
 * charts.test.ts rejects `containLabel` so this does not regress.
 */
export function gridBox(box: { left?: number; right?: number; top?: number; bottom?: number } = {}) {
  return {
    left: 8,
    right: 16,
    top: 16,
    bottom: 8,
    ...box,
    outerBoundsMode: "same",
    outerBoundsContain: "all",
  } as const;
}
