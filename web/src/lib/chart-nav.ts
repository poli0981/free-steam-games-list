/**
 * The chart catalogue, shared by the sidebar and the /charts index page so the
 * two can never drift. Eleven separate sidebar entries crowded out everything
 * else in the nav; the sidebar links to /charts and this list is what that page
 * renders.
 */
import type { Component } from "svelte";
import BarChart3 from "@lucide/svelte/icons/chart-column";
import Clock from "@lucide/svelte/icons/clock";
import Globe from "@lucide/svelte/icons/globe";
import LanguagesIcon from "@lucide/svelte/icons/languages";
import Lock from "@lucide/svelte/icons/lock";
import PieChart from "@lucide/svelte/icons/chart-pie";
import Shield from "@lucide/svelte/icons/shield";
import TagsIcon from "@lucide/svelte/icons/tags";
import Users from "@lucide/svelte/icons/users";
import WifiOff from "@lucide/svelte/icons/wifi-off";

export interface ChartNavItem {
  to: string;
  /** Key under "nav.*". */
  i18n: string;
  /** Key under "charts.desc.*" — one line on the index page. */
  desc: string;
  icon: Component<{ class?: string }>;
}

export const CHART_PAGES: ChartNavItem[] = [
  { to: "/charts/genres", i18n: "nav.genres", desc: "charts.desc.genres", icon: PieChart },
  { to: "/charts/platforms", i18n: "nav.platforms", desc: "charts.desc.platforms", icon: Globe },
  { to: "/charts/languages", i18n: "nav.languages", desc: "charts.desc.languages", icon: LanguagesIcon },
  { to: "/charts/tags", i18n: "nav.tags", desc: "charts.desc.tags", icon: TagsIcon },
  { to: "/charts/anti-cheat", i18n: "nav.antiCheat", desc: "charts.desc.antiCheat", icon: Shield },
  { to: "/charts/anti-cheat/list", i18n: "nav.antiCheatList", desc: "charts.desc.antiCheatList", icon: Shield },
  { to: "/charts/reviews", i18n: "nav.reviews", desc: "charts.desc.reviews", icon: BarChart3 },
  { to: "/charts/players", i18n: "nav.players", desc: "charts.desc.players", icon: Users },
  { to: "/charts/time", i18n: "nav.time", desc: "charts.desc.time", icon: Clock },
  { to: "/charts/drm", i18n: "nav.drmDlc", desc: "charts.desc.drm", icon: Lock },
  { to: "/charts/delisted", i18n: "nav.delisted", desc: "charts.desc.delisted", icon: WifiOff },
];
