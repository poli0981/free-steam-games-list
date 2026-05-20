import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGames } from "../hooks/useGames";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { LoadingState, ErrorState } from "../components/common/QueryState";
import { ANTI_CHEAT_ENUM } from "../lib/enums";
import { formatNumber, parseIntSafe, cn } from "../lib/utils";
import type { GameRecord } from "../lib/schema";

// Substring patterns per canonical AC name — mirrors
// `ANTI_CHEAT_PATTERNS` in scripts/core/constants.py. Keep in sync.
const AC_PATTERNS: Record<string, string[]> = {
  VAC: ["valve anti-cheat", "valve anti cheat", "vac enabled"],
  EAC: ["easy anti-cheat", "easy anti cheat", "easyanticheat"],
  BattlEye: ["battleye", "battle eye"],
  Vanguard: ["vanguard", "riot vanguard"],
  PunkBuster: ["punkbuster", "punk buster"],
  nProtect: ["nprotect", "gameguard"],
  XIGNCODE: ["xigncode", "xigncode3"],
  Ricochet: ["ricochet anti-cheat", "ricochet"],
  mHyprot: ["mhyprot", "mhyprot2"],
  "FACEIT AC": ["faceit anti-cheat", "faceit ac"],
  "Denuvo AC": ["denuvo anti-cheat"],
  KSS: ["kss", "krafton security"],
  "NetEase GS": ["netease game security"],
  Hyperion: ["hyperion", "byfron"],
};

const CANONICAL_ORDER = ANTI_CHEAT_ENUM.filter((k) => k !== "-");

function canonicalAc(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === "-" || s === "none" || s === "no" || s === "n/a") return null;
  for (const name of CANONICAL_ORDER) {
    if (s.includes(name.toLowerCase())) return name;
    for (const p of AC_PATTERNS[name] ?? []) {
      if (s.includes(p)) return name;
    }
  }
  return "Other";
}

interface Bucket {
  key: string;
  games: GameRecord[];
}

export function AntiCheatListPage() {
  const { t } = useTranslation();
  useDocumentTitle("antiCheatList.title");
  const q = useGames();

  const buckets = useMemo<Bucket[]>(() => {
    if (!q.data) return [];
    const map = new Map<string, GameRecord[]>();
    for (const g of q.data.records) {
      if (g.status !== "active") continue;
      const ac = canonicalAc(g.anti_cheat ?? "");
      if (!ac) continue;
      if (!map.has(ac)) map.set(ac, []);
      map.get(ac)!.push(g);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => parseIntSafe(b.current_players) - parseIntSafe(a.current_players),
      );
    }
    const ordered: Bucket[] = [];
    for (const key of CANONICAL_ORDER) {
      if (map.has(key)) ordered.push({ key, games: map.get(key)! });
    }
    if (map.has("Other")) ordered.push({ key: "Other", games: map.get("Other")! });
    return ordered;
  }, [q.data]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  const total = buckets.reduce((s, b) => s + b.games.length, 0);

  function scrollToFamily(key: string) {
    const id = key.toLowerCase().replace(/\s+/g, "-");
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex gap-6">
      <aside className="hidden shrink-0 md:block md:w-40 lg:w-48">
        <div className="sticky top-4 space-y-1">
          <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("antiCheatList.families")}
          </div>
          {buckets.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => scrollToFamily(b.key)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span>{b.key}</span>
              <span className="font-mono text-xs">{b.games.length}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("antiCheatList.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("antiCheatList.subtitle", { total, families: buckets.length })}
          </p>
        </div>

        {/* Mobile horizontal chip nav — < md only, replaces hidden sidebar */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 md:hidden [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {buckets.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => scrollToFamily(b.key)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs hover:bg-accent"
            >
              <span>{b.key}</span>
              <span className="font-mono text-muted-foreground">{b.games.length}</span>
            </button>
          ))}
        </div>

        {buckets.map((b) => (
          <Card key={b.key} id={b.key.toLowerCase().replace(/\s+/g, "-")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle>{b.key}</CardTitle>
              <Badge variant="secondary">{b.games.length}</Badge>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="w-12 px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">{t("antiCheatList.game")}</th>
                      <th className="px-3 py-2 text-left">{t("antiCheatList.genre")}</th>
                      <th className="px-3 py-2 text-left">{t("antiCheatList.kernel")}</th>
                      <th className="px-3 py-2 text-right">{t("antiCheatList.players")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.games.map((g, i) => (
                      <tr key={g.link} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {i + 1}
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={g.link}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium hover:text-primary hover:underline"
                          >
                            {g.name || "—"}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {g.genre || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {g.is_kernel_ac === true ? (
                            <Badge variant="destructive" className="font-normal">
                              {t("common.yes")}
                            </Badge>
                          ) : g.is_kernel_ac === false ? (
                            <Badge variant="secondary" className="font-normal">
                              {t("common.no")}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-mono",
                            parseIntSafe(g.current_players) > 0
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {formatNumber(g.current_players)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
