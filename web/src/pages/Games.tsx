import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useGames } from "../hooks/useGames";
import { GamesTable } from "../components/games/GamesTable";
import { GameDetailDrawer } from "../components/games/GameDetailDrawer";
import { LoadingState, ErrorState } from "../components/common/QueryState";
import { useFilters } from "../stores/filters";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { X } from "lucide-react";

export function GamesPage() {
  const { t } = useTranslation();
  const q = useGames();
  const navigate = useNavigate();
  const { appid } = useParams<{ appid: string }>();
  const genre = useFilters((s) => s.genre);
  const setGenre = useFilters((s) => s.setGenre);
  const typeGame = useFilters((s) => s.type_game);
  const setTypeGame = useFilters((s) => s.setTypeGame);
  const platform = useFilters((s) => s.platform);
  const setPlatform = useFilters((s) => s.setPlatform);
  const status = useFilters((s) => s.status);
  const setStatus = useFilters((s) => s.setStatus);
  const hideDead = useFilters((s) => s.hideDead);
  const setHideDead = useFilters((s) => s.setHideDead);
  const reset = useFilters((s) => s.reset);

  const facets = useMemo(() => {
    const records = q.data?.records ?? [];
    const genres = new Map<string, number>();
    const platforms = new Map<string, number>();
    for (const r of records) {
      if (r.genre) genres.set(r.genre, (genres.get(r.genre) ?? 0) + 1);
      for (const p of r.platforms ?? []) {
        platforms.set(p, (platforms.get(p) ?? 0) + 1);
      }
    }
    return {
      genres: Array.from(genres.entries()).sort((a, b) => b[1] - a[1]),
      platforms: Array.from(platforms.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [q.data]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  const hasFilter = genre || typeGame || platform || status || hideDead;
  const linkedGame = appid
    ? (() => {
        const idx = q.data.appidIndex.get(appid);
        return idx === undefined ? null : q.data.records[idx];
      })()
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("games.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("games.subtitle")}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <select
          value={genre ?? ""}
          onChange={(e) => setGenre(e.target.value || null)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{t("games.filterAllGenres")}</option>
          {facets.genres.map(([g, n]) => (
            <option key={g} value={g}>
              {g} ({n})
            </option>
          ))}
        </select>

        <select
          value={typeGame ?? ""}
          onChange={(e) =>
            setTypeGame((e.target.value as "online" | "offline") || null)
          }
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{t("games.filterAllTypes")}</option>
          <option value="online">{t("common.online")}</option>
          <option value="offline">{t("common.offline")}</option>
        </select>

        <select
          value={platform ?? ""}
          onChange={(e) => setPlatform(e.target.value || null)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{t("games.filterAllPlatforms")}</option>
          {facets.platforms.map(([p, n]) => (
            <option key={p} value={p}>
              {p} ({n})
            </option>
          ))}
        </select>

        <select
          value={status ?? ""}
          onChange={(e) =>
            setStatus((e.target.value as "active" | "delisted") || null)
          }
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{t("games.filterAllStatus")}</option>
          <option value="active">{t("common.active")}</option>
          <option value="delisted">{t("common.delisted")}</option>
        </select>

        <label className="flex h-8 select-none items-center gap-1.5 rounded-md border bg-background px-2 text-sm">
          <input
            type="checkbox"
            checked={hideDead}
            onChange={(e) => setHideDead(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input bg-transparent accent-primary"
          />
          {t("games.hideDead")}
        </label>

        {hasFilter && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <X className="mr-1 h-3 w-3" /> {t("common.clear")}
          </Button>
        )}

        <div className="ml-auto flex gap-1.5">
          {genre && <Badge variant="default">genre: {genre}</Badge>}
          {typeGame && <Badge variant="default">type: {typeGame}</Badge>}
          {platform && <Badge variant="default">platform: {platform}</Badge>}
          {status && <Badge variant="default">status: {status}</Badge>}
          {hideDead && <Badge variant="default">💀 hidden</Badge>}
        </div>
      </div>

      <GamesTable
        records={q.data.records}
        onRowOpen={(g) => navigate(`/games/${g.link.match(/\/app\/(\d+)/)?.[1] ?? ""}`)}
      />

      {appid && (
        <GameDetailDrawer
          game={linkedGame}
          onClose={() => navigate("/games")}
          missing={!linkedGame ? appid : undefined}
        />
      )}
    </div>
  );
}
