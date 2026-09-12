/**
 * The single source of truth for navigation.
 *
 * The React app had THREE independent lists that could drift: the sidebar's
 * PRIMARY/SECONDARY arrays, `chart-nav.ts`'s CHART_PAGES, and the command
 * palette's own NAV of 17 hardcoded English labels. They had already drifted —
 * the palette was missing /top-offline, /donate, /charts/anti-cheat/list,
 * /charts/delisted and /welcome, and its labels were the only untranslated
 * strings in an otherwise fully translated app.
 *
 * Now: this file plus CHART_PAGES, and the palette is built from both.
 */
import type { Component } from "svelte";
import BarChart3 from "@lucide/svelte/icons/chart-column";
import Gamepad2 from "@lucide/svelte/icons/gamepad-2";
import Heart from "@lucide/svelte/icons/heart";
import HeartPulse from "@lucide/svelte/icons/heart-pulse";
import History from "@lucide/svelte/icons/history";
import Info from "@lucide/svelte/icons/info";
import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
import Settings from "@lucide/svelte/icons/settings";
import Swords from "@lucide/svelte/icons/swords";
import Trophy from "@lucide/svelte/icons/trophy";
import Users from "@lucide/svelte/icons/users";
import Building2 from "@lucide/svelte/icons/building-2";
import Sigma from "@lucide/svelte/icons/sigma";

export interface NavItem {
  to: string;
  /** Key under "nav.*". */
  i18n: string;
  icon: Component<{ class?: string }>;
  /** Match this path exactly rather than by prefix. Only "/" needs it. */
  exact?: boolean;
}

/**
 * The browse surfaces. Icons are all distinct: the old rail used Trophy for
 * BOTH leaderboards and Shield for two different anti-cheat entries, which
 * makes an icon useless as a way to find a row.
 */
export const PRIMARY: NavItem[] = [
  { to: "/", i18n: "nav.dashboard", icon: LayoutDashboard, exact: true },
  { to: "/games", i18n: "nav.games", icon: Gamepad2 },
  { to: "/top-online", i18n: "nav.topOnline", icon: Users },
  { to: "/top-offline", i18n: "nav.topOffline", icon: Trophy },
  { to: "/charts", i18n: "nav.charts", icon: BarChart3 },
  { to: "/stats", i18n: "nav.stats", icon: Sigma },
  { to: "/developers", i18n: "nav.developers", icon: Building2 },
];

/** Everything that is about the project rather than the catalogue. */
export const SECONDARY: NavItem[] = [
  { to: "/health", i18n: "nav.health", icon: HeartPulse },
  { to: "/activity", i18n: "nav.activity", icon: History },
  { to: "/about", i18n: "nav.about", icon: Info },
  { to: "/donate", i18n: "nav.donate", icon: Heart },
  { to: "/settings", i18n: "nav.settings", icon: Settings },
];

/** Not in the rail, but reachable from the palette and linked from About. */
export const EXTRA: NavItem[] = [
  { to: "/welcome", i18n: "nav.welcome", icon: Info },
  { to: "/publishers", i18n: "nav.publishers", icon: Building2 },
  { to: "/charts/anti-cheat/list", i18n: "nav.antiCheatList", icon: Swords },
];

/**
 * Is `href` the active route for `path`?
 *
 * Prefix matching, so /games/730 highlights /games — but guarded on a segment
 * boundary, or /charts would light up for /charts-something. "/" is exact, or
 * it would match everything.
 */
export function isActive(current: string, item: Pick<NavItem, "to" | "exact">): boolean {
  if (item.exact) return current === item.to;
  return current === item.to || current.startsWith(item.to + "/");
}
