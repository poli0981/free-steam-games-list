import { NavLink, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useIsOwner } from "../../hooks/useIsOwner";
import {
  LayoutDashboard,
  Gamepad2,
  Trophy,
  HeartPulse,
  PlusCircle,
  Settings,
  BarChart3,
  PieChart,
  Globe,
  Tags as TagsIcon,
  Shield,
  Languages as LanguagesIcon,
  Clock,
  Users,
  Lock,
  History,
  Info,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Sheet, SheetContent } from "../ui/sheet";

interface NavItem {
  to: string;
  /** i18n key under "nav.*". */
  i18n: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

const PRIMARY: NavItem[] = [
  { to: "/", i18n: "nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/games", i18n: "nav.games", icon: Gamepad2 },
  { to: "/top-online", i18n: "nav.topOnline", icon: Trophy },
];

const CHARTS: NavItem[] = [
  { to: "/charts/genres", i18n: "nav.genres", icon: PieChart },
  { to: "/charts/platforms", i18n: "nav.platforms", icon: Globe },
  { to: "/charts/languages", i18n: "nav.languages", icon: LanguagesIcon },
  { to: "/charts/tags", i18n: "nav.tags", icon: TagsIcon },
  { to: "/charts/anti-cheat", i18n: "nav.antiCheat", icon: Shield },
  { to: "/charts/reviews", i18n: "nav.reviews", icon: BarChart3 },
  { to: "/charts/players", i18n: "nav.players", icon: Users },
  { to: "/charts/time", i18n: "nav.time", icon: Clock },
  { to: "/charts/drm", i18n: "nav.drmDlc", icon: Lock },
];

interface NavItemWithOwner extends NavItem {
  ownerOnly?: boolean;
}

const SECONDARY: NavItemWithOwner[] = [
  { to: "/health", i18n: "nav.health", icon: HeartPulse },
  { to: "/activity", i18n: "nav.activity", icon: History },
  { to: "/add", i18n: "nav.add", icon: PlusCircle, ownerOnly: true },
  { to: "/about", i18n: "nav.about", icon: Info },
  { to: "/settings", i18n: "nav.settings", icon: Settings },
];

interface ItemProps {
  item: NavItem;
  onSelect?: () => void;
}

function Item({ item, onSelect }: ItemProps) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onSelect}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )
      }
    >
      <item.icon className="h-4 w-4" />
      {t(item.i18n)}
    </NavLink>
  );
}

interface SidebarBodyProps {
  onSelect?: () => void;
}

/** Inner content shared between desktop sidebar + mobile drawer. */
function SidebarBody({ onSelect }: SidebarBodyProps) {
  const { t } = useTranslation();
  const isOwner = useIsOwner();
  const visibleSecondary = SECONDARY.filter((i) => !i.ownerOnly || isOwner);
  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
          <Gamepad2 className="h-4 w-4" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">F2P Tracker</span>
          <span className="text-xs text-muted-foreground">Steam · v1.0</span>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-2 py-4">
        <div className="space-y-1">
          {PRIMARY.map((i) => (
            <Item key={i.to} item={i} onSelect={onSelect} />
          ))}
        </div>

        <div>
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("nav.charts")}
          </div>
          <div className="space-y-1">
            {CHARTS.map((i) => (
              <Item key={i.to} item={i} onSelect={onSelect} />
            ))}
          </div>
        </div>

        <div>
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("nav.manage")}
          </div>
          <div className="space-y-1">
            {visibleSecondary.map((i) => (
              <Item key={i.to} item={i} onSelect={onSelect} />
            ))}
          </div>
        </div>
      </nav>

      <div className="border-t px-4 py-3 text-xs text-muted-foreground">
        <a
          href="https://github.com/poli0981/free-steam-games-list"
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground"
          onClick={onSelect}
        >
          poli0981 / free-steam-games-list
        </a>
      </div>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card/40 lg:flex lg:flex-col">
      <SidebarBody />
    </aside>
  );
}

interface MobileSidebarProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/**
 * Mobile-only sheet that mirrors the desktop sidebar. Auto-closes on route
 * change so tapping a nav item works as expected without an extra X click.
 */
export function MobileSidebar({ open, onOpenChange }: MobileSidebarProps) {
  const location = useLocation();
  useEffect(() => {
    if (open) onOpenChange(false);
    // We only want to react to the location pathname change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-72 flex-col p-0">
        <SidebarBody onSelect={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
