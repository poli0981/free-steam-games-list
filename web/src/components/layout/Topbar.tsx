import { Search, Sun, Moon, Monitor, ShieldCheck, Unlock, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { PwaIndicator } from "../common/PwaIndicator";
import { GpgQuickUnlock } from "../auth/GpgQuickUnlock";
import { useFilters } from "../../stores/filters";
import { useGames } from "../../hooks/useGames";
import { useAuth } from "../../stores/auth";
import { useGpg } from "../../stores/gpg";
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
  const search = useFilters((s) => s.search);
  const setSearch = useFilters((s) => s.setSearch);
  const games = useGames();
  const auth = useAuth();
  const gpgParsed = useGpg((s) => s.parsed);
  const gpgUnlocked = useGpg((s) => s.unlocked);
  const gpgLock = useGpg((s) => s.lock);
  const gpgHydrate = useGpg((s) => s.hydrate);
  const [theme, setTheme] = useState<Theme>(
    (localStorage.getItem("f2p:theme") as Theme) ?? "dark",
  );

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("f2p:theme", theme);
  }, [theme]);

  useEffect(() => {
    if (auth.token && !auth.user && !auth.isVerifying) {
      void auth.hydrate();
    }
  }, [auth.token, auth.user, auth.isVerifying, auth]);

  useEffect(() => {
    void gpgHydrate();
  }, [gpgHydrate]);

  const total = games.data?.records.length ?? 0;
  const lastUpdated = games.data?.index.last_updated ?? "";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open menu"
        className="-ml-2 lg:hidden"
        onClick={onMenuToggle}
      >
        <Menu className="h-4 w-4" />
      </Button>

      <div className="relative flex-1 max-w-xl">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, tag, description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 pr-14"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden h-5 -translate-y-1/2 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground md:inline-flex">
          ⌘K
        </kbd>
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

      <PwaIndicator />

      {auth.isAuthenticated && auth.user ? (
        <div className="hidden items-center gap-2 md:flex">
          {gpgParsed &&
            (gpgUnlocked ? (
              <button
                onClick={gpgLock}
                title={`GPG unlocked · ${gpgParsed.primaryEmail || gpgParsed.keyId} · click to lock`}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/15"
              >
                <Unlock className="h-3 w-3" />
                <span>signed</span>
              </button>
            ) : (
              <GpgQuickUnlock />
            ))}
          <Link
            to="/settings"
            className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs hover:bg-accent"
            title={`Signed in as @${auth.user.login}`}
          >
            <img
              src={auth.user.avatar_url}
              alt=""
              className="h-5 w-5 rounded-full"
            />
            <span className="font-medium">@{auth.user.login}</span>
            <Badge variant="success" className="px-1.5 py-0">
              <ShieldCheck className="h-3 w-3" />
            </Badge>
          </Link>
        </div>
      ) : (
        <Link to="/settings">
          <Button variant="outline" size="sm" className="hidden md:inline-flex">
            Sign in
          </Button>
        </Link>
      )}

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
