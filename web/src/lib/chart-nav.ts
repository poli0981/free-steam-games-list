/**
 * The chart catalogue, shared by the sidebar and the /charts index page so the
 * two can never drift. Eleven separate sidebar entries crowded out everything
 * else in the nav; the sidebar now links to /charts and this list is what that
 * page renders.
 */
import {
  PieChart,
  Globe,
  Languages as LanguagesIcon,
  Tags as TagsIcon,
  Shield,
  BarChart3,
  Users,
  Clock,
  Lock,
  WifiOff,
} from "lucide-react";

export interface ChartNavItem {
  to: string;
  /** Key under "nav.*". */
  i18n: string;
  /** Key under "charts.desc.*" — one line on the index page. */
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
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
