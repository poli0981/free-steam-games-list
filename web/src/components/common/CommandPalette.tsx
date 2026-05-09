import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Gamepad2,
  Trophy,
  HeartPulse,
  PlusCircle,
  Settings as SettingsIcon,
  PieChart,
  Globe,
  Tags as TagsIcon,
  Shield,
  BarChart3,
  Languages as LanguagesIcon,
  Clock,
  Users,
  Lock,
  Unlock,
  ExternalLink,
  Search,
  History,
  Info,
} from "lucide-react";
import { useGames } from "../../hooks/useGames";
import { useGpg } from "../../stores/gpg";
import { headerToCapsule } from "../../lib/image";
import "./command-palette.css";

interface NavCmd {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "Pages" | "Charts" | "Manage";
  keywords?: string[];
}

const NAV: NavCmd[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard, group: "Pages" },
  { label: "Games", to: "/games", icon: Gamepad2, group: "Pages" },
  { label: "Top Online", to: "/top-online", icon: Trophy, group: "Pages" },
  { label: "Health", to: "/health", icon: HeartPulse, group: "Pages" },
  { label: "Activity", to: "/activity", icon: History, group: "Pages" },
  { label: "Add games", to: "/add", icon: PlusCircle, group: "Pages" },
  { label: "About", to: "/about", icon: Info, group: "Pages" },
  { label: "Settings", to: "/settings", icon: SettingsIcon, group: "Pages" },
  { label: "Genres treemap", to: "/charts/genres", icon: PieChart, group: "Charts" },
  { label: "Platforms donut", to: "/charts/platforms", icon: Globe, group: "Charts" },
  { label: "Languages heatmap", to: "/charts/languages", icon: LanguagesIcon, group: "Charts" },
  { label: "Tags word cloud", to: "/charts/tags", icon: TagsIcon, group: "Charts" },
  { label: "Anti-cheat by genre", to: "/charts/anti-cheat", icon: Shield, group: "Charts" },
  { label: "Reviews histogram", to: "/charts/reviews", icon: BarChart3, group: "Charts" },
  { label: "Player tiers", to: "/charts/players", icon: Users, group: "Charts" },
  { label: "Time / release year", to: "/charts/time", icon: Clock, group: "Charts" },
  { label: "DRM & paid DLC", to: "/charts/drm", icon: Lock, group: "Charts" },
];

export function CommandPalette() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const games = useGames();
  const gpg = useGpg();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function go(to: string) {
    navigate(to);
    setOpen(false);
    setSearch("");
  }

  const gameMatches = (() => {
    if (!games.data || search.trim().length < 2) return [];
    const q = search.toLowerCase();
    const out = [];
    for (const r of games.data.records) {
      if (r.name && r.name.toLowerCase().includes(q)) {
        out.push(r);
        if (out.length >= 8) break;
      }
    }
    return out;
  })();

  if (!open) return null;

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk-shell" onClick={(e) => e.stopPropagation()}>
        <Command className="cmdk-root" shouldFilter>
          <div className="cmdk-input-row">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Command.Input
              autoFocus
              placeholder={t("cmdk.placeholder")}
              value={search}
              onValueChange={setSearch}
              className="cmdk-input"
            />
            <kbd className="cmdk-kbd">esc</kbd>
          </div>

          <Command.List className="cmdk-list">
            <Command.Empty className="cmdk-empty">{t("cmdk.noMatches")}</Command.Empty>

            <Command.Group heading={t("cmdk.groupPages")} className="cmdk-group">
              {NAV.filter((n) => n.group === "Pages").map((n) => (
                <Command.Item
                  key={n.to}
                  onSelect={() => go(n.to)}
                  className="cmdk-item"
                  keywords={n.keywords}
                  value={n.label}
                >
                  <n.icon className="h-3.5 w-3.5" />
                  {n.label}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading={t("cmdk.groupCharts")} className="cmdk-group">
              {NAV.filter((n) => n.group === "Charts").map((n) => (
                <Command.Item
                  key={n.to}
                  onSelect={() => go(n.to)}
                  className="cmdk-item"
                  value={n.label}
                >
                  <n.icon className="h-3.5 w-3.5" />
                  {n.label}
                </Command.Item>
              ))}
            </Command.Group>

            {gpg.parsed && (
              <Command.Group heading={t("cmdk.groupGpg")} className="cmdk-group">
                {gpg.unlocked ? (
                  <Command.Item
                    onSelect={() => {
                      gpg.lock();
                      setOpen(false);
                    }}
                    className="cmdk-item"
                    value={t("cmdk.lockGpgKey")}
                  >
                    <Lock className="h-3.5 w-3.5" />
                    {t("cmdk.lockGpgKey")}
                  </Command.Item>
                ) : (
                  <Command.Item
                    onSelect={() => go("/settings")}
                    className="cmdk-item"
                    value={t("cmdk.unlockGpgSettings")}
                  >
                    <Unlock className="h-3.5 w-3.5" />
                    {t("cmdk.unlockGpgSettings")}
                  </Command.Item>
                )}
              </Command.Group>
            )}

            {gameMatches.length > 0 && (
              <Command.Group heading={t("cmdk.groupGames")} className="cmdk-group">
                {gameMatches.map((r) => (
                  <Command.Item
                    key={r.link}
                    onSelect={() => {
                      window.open(r.link, "_blank");
                      setOpen(false);
                    }}
                    className="cmdk-item"
                    value={r.name}
                  >
                    {r.header_image ? (
                      <img
                        loading="lazy"
                        src={headerToCapsule(r.header_image)}
                        alt=""
                        width={92}
                        height={43}
                        className="h-4 w-7 rounded object-cover"
                        onError={(e) => {
                          const el = e.currentTarget;
                          if (el.src !== r.header_image) el.src = r.header_image;
                        }}
                      />
                    ) : (
                      <Gamepad2 className="h-3.5 w-3.5" />
                    )}
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{r.genre}</span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div className="cmdk-footer">
            <kbd className="cmdk-kbd">↑</kbd>
            <kbd className="cmdk-kbd">↓</kbd>
            <span className="text-xs text-muted-foreground">{t("cmdk.kbdNavigate")}</span>
            <kbd className="cmdk-kbd ml-auto">↵</kbd>
            <span className="text-xs text-muted-foreground">{t("cmdk.kbdSelect")}</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
