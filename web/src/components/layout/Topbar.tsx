import { Search, Sun, Moon, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
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

export function Topbar() {
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
      <div className="relative flex-1 max-w-xl">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, tag, description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
        <span>
          <strong className="text-foreground">{formatNumber(total)}</strong> games
        </span>
        {lastUpdated && (
          <span title={lastUpdated}>
            updated {lastUpdated.slice(0, 10)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Light"
          onClick={() => setTheme("light")}
          className={theme === "light" ? "text-foreground" : "text-muted-foreground"}
        >
          <Sun className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dark"
          onClick={() => setTheme("dark")}
          className={theme === "dark" ? "text-foreground" : "text-muted-foreground"}
        >
          <Moon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="System"
          onClick={() => setTheme("system")}
          className={theme === "system" ? "text-foreground" : "text-muted-foreground"}
        >
          <Monitor className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
