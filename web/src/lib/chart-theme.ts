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
 */

function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  // Tokens are stored as bare HSL channels ("204 92% 56%") so Tailwind can
  // apply opacity modifiers to them.
  return raw ? `hsl(${raw})` : fallback;
}

export interface ChartTheme {
  text: string;
  mutedText: string;
  grid: string;
  border: string;
  card: string;
  series: string[];
}

/** Resolve once per chart render — cheap, and picks up a theme switch. */
export function chartTheme(): ChartTheme {
  const primary = token("--primary", "hsl(204 92% 56%)");
  return {
    text: token("--card-foreground", "hsl(210 28% 96%)"),
    mutedText: token("--muted-foreground", "hsl(216 17% 64%)"),
    grid: token("--border", "hsl(220 15% 19%)"),
    border: token("--border-strong", "hsl(220 14% 27%)"),
    card: token("--card", "hsl(224 20% 10%)"),
    // A categorical ramp that starts at the brand primary and stays
    // distinguishable in both themes.
    series: [
      primary,
      token("--success", "hsl(152 55% 48%)"),
      token("--warning", "hsl(36 92% 58%)"),
      "hsl(268 84% 68%)",
      "hsl(330 78% 62%)",
      "hsl(174 66% 46%)",
      "hsl(22 88% 60%)",
      "hsl(224 70% 68%)",
    ],
  };
}
