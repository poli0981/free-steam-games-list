import { NavLink, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Gamepad2,
  Trophy,
  HeartPulse,
  Settings,
  BarChart3,
  History,
  Info,
  Heart,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet";

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
  { to: "/top-offline", i18n: "nav.topOffline", icon: Trophy },
  { to: "/charts", i18n: "nav.charts", icon: BarChart3 },
];


const SECONDARY: NavItem[] = [
  { to: "/health", i18n: "nav.health", icon: HeartPulse },
  { to: "/activity", i18n: "nav.activity", icon: History },
  { to: "/about", i18n: "nav.about", icon: Info },
  { to: "/donate", i18n: "nav.donate", icon: Heart },
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
            {t("nav.manage")}
          </div>
          <div className="space-y-1">
            {SECONDARY.map((i) => (
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
  const { t } = useTranslation();
  const location = useLocation();
  useEffect(() => {
    if (open) onOpenChange(false);
    // We only want to react to the location pathname change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* aria-describedby={undefined} tells Radix this drawer intentionally has
          no description; without it Radix warns about the missing association.
          The title is sr-only because the drawer is visually self-evident but
          a screen reader still needs it announced. */}
      <SheetContent
        side="left"
        className="flex w-72 flex-col p-0"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">{t("nav.menu")}</SheetTitle>
        <SidebarBody onSelect={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
