import { NavLink, useLocation } from "react-router-dom";
import { useEffect } from "react";
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
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

const PRIMARY: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/games", label: "Games", icon: Gamepad2 },
  { to: "/top-online", label: "Top Online", icon: Trophy },
];

const CHARTS: NavItem[] = [
  { to: "/charts/genres", label: "Genres", icon: PieChart },
  { to: "/charts/platforms", label: "Platforms", icon: Globe },
  { to: "/charts/languages", label: "Languages", icon: LanguagesIcon },
  { to: "/charts/tags", label: "Tags", icon: TagsIcon },
  { to: "/charts/anti-cheat", label: "Anti-Cheat", icon: Shield },
  { to: "/charts/reviews", label: "Reviews", icon: BarChart3 },
  { to: "/charts/players", label: "Players", icon: Users },
  { to: "/charts/time", label: "Time", icon: Clock },
  { to: "/charts/drm", label: "DRM/DLC", icon: Lock },
];

interface NavItemWithOwner extends NavItem {
  ownerOnly?: boolean;
}

const SECONDARY: NavItemWithOwner[] = [
  { to: "/health", label: "Health", icon: HeartPulse },
  { to: "/activity", label: "Activity", icon: History },
  { to: "/add", label: "Add", icon: PlusCircle, ownerOnly: true },
  { to: "/about", label: "About", icon: Info },
  { to: "/settings", label: "Settings", icon: Settings },
];

interface ItemProps {
  item: NavItem;
  onSelect?: () => void;
}

function Item({ item, onSelect }: ItemProps) {
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
      {item.label}
    </NavLink>
  );
}

interface SidebarBodyProps {
  onSelect?: () => void;
}

/** Inner content shared between desktop sidebar + mobile drawer. */
function SidebarBody({ onSelect }: SidebarBodyProps) {
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
          <span className="text-xs text-muted-foreground">Steam · v0.1</span>
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
            Charts
          </div>
          <div className="space-y-1">
            {CHARTS.map((i) => (
              <Item key={i.to} item={i} onSelect={onSelect} />
            ))}
          </div>
        </div>

        <div>
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Manage
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
