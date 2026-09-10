import { Search, Sun, Moon, Monitor, Menu, Command } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { PwaIndicator } from "../common/PwaIndicator";
import { openCommandPalette } from "../common/CommandPalette";
import { useFilters } from "../../stores/filters";
import { useGames } from "../../hooks/useGames";
import { formatNumber } from "../../lib/utils";

type Theme = "light" | "dark" | "system";

function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  if (t === "system") {
    const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.add(prefers ? "dark" : "light");
  } else {
    root.classList.add(t);
  }
}

interface TopbarProps {
  /** Hamburger handler — only shown on viewports without the desktop sidebar. */
  onMenuToggle?: () => void;
}

export function Topbar({ onMenuToggle }: TopbarProps = {}) {
  const { t } = useTranslation();
  const search = useFilters((s) => s.search);
  const setSearch = useFilters((s) => s.setSearch);
  const games = useGames();
  const [theme, setTheme] = useState<Theme>(
    (localStorage.getItem("f2p:theme") as Theme) ?? "dark",
  );

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("f2p:theme", theme);
  }, [theme]);

  const total = games.data?.records.length ?? 0;
  const lastUpdated = games.data?.index.last_updated ?? "";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("topbar.menuOpen")}
        className="-ml-2 lg:hidden"
        onClick={onMenuToggle}
      >
        <Menu className="h-4 w-4" />
      </Button>

      <div className="relative flex-1 max-w-xl">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("topbar.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 pr-14"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden h-5 -translate-y-1/2 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground md:inline-flex">
          ⌘K
        </kbd>
        {/* Touch equivalent of ⌘K — the soft keyboard can't send the chord. */}
        <button
          type="button"
          aria-label={t("cmdk.placeholder")}
          onClick={openCommandPalette}
          className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground md:hidden"
        >
          <Command className="h-4 w-4" />
        </button>
      </div>

      <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
        <span
          dangerouslySetInnerHTML={{
            __html: t("topbar.gamesCount", { count: total }).replace(
              String(total),
              `<strong class="text-foreground">${formatNumber(total)}</strong>`,
            ),
          }}
        />
        {lastUpdated && (
          <span title={lastUpdated}>
            {t("topbar.updated", { date: lastUpdated.slice(0, 10) })}
          </span>
        )}
      </div>

      <PwaIndicator />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("system.themeLight")}
          onClick={() => setTheme("light")}
          className={theme === "light" ? "text-foreground" : "text-muted-foreground"}
        >
          <Sun className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("system.themeDark")}
          onClick={() => setTheme("dark")}
          className={theme === "dark" ? "text-foreground" : "text-muted-foreground"}
        >
          <Moon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("system.themeSystem")}
          onClick={() => setTheme("system")}
          className={theme === "system" ? "text-foreground" : "text-muted-foreground"}
        >
          <Monitor className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
