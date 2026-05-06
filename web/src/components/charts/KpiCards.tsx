import { useMemo } from "react";
import { Card, CardContent } from "../ui/card";
import { formatNumber, parseIntSafe, parseReviewPercent } from "../../lib/utils";
import type { GameRecord } from "../../lib/schema";
import { TrendingUp, Gamepad2, Globe, Star, Wifi, WifiOff } from "lucide-react";

interface Props {
  records: GameRecord[];
  lastUpdated?: string;
}

interface Kpi {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}

function computeKpis(records: GameRecord[], lastUpdated?: string): Kpi[] {
  const total = records.length;
  let online = 0;
  let offline = 0;
  let totalCurrentPlayers = 0;
  let topPlayers = 0;
  let topPlayersGame = "—";
  let dead = 0;
  let reviewSum = 0;
  let reviewCount = 0;
  const genreCount = new Map<string, number>();

  for (const r of records) {
    if (r.type_game === "online") online++;
    else if (r.type_game === "offline") offline++;
    if (r.status === "delisted") dead++;

    const cp = parseIntSafe(r.current_players);
    totalCurrentPlayers += cp;
    if (cp > topPlayers) {
      topPlayers = cp;
      topPlayersGame = r.name;
    }
    const pct = parseReviewPercent(r.reviews);
    if (pct !== null) {
      reviewSum += pct;
      reviewCount++;
    }
    if (r.genre) genreCount.set(r.genre, (genreCount.get(r.genre) ?? 0) + 1);
  }

  let topGenre = "—";
  let topGenreN = 0;
  for (const [g, n] of genreCount) {
    if (n > topGenreN) {
      topGenreN = n;
      topGenre = g;
    }
  }

  const avgReview = reviewCount ? Math.round(reviewSum / reviewCount) : 0;

  return [
    {
      label: "Total games",
      value: formatNumber(total),
      hint: lastUpdated ? `last updated ${lastUpdated.slice(0, 10)}` : undefined,
      icon: Gamepad2,
      accent: "text-blue-400",
    },
    {
      label: "Online vs offline",
      value: `${formatNumber(online)} / ${formatNumber(offline)}`,
      hint: `${total ? Math.round((online / total) * 100) : 0}% online`,
      icon: Wifi,
      accent: "text-emerald-400",
    },
    {
      label: "Sum current players",
      value: formatNumber(totalCurrentPlayers),
      hint: `top: ${topPlayersGame}`,
      icon: TrendingUp,
      accent: "text-violet-400",
    },
    {
      label: "Avg review %",
      value: avgReview ? `${avgReview}%` : "—",
      hint: `${formatNumber(reviewCount)} rated`,
      icon: Star,
      accent: "text-amber-400",
    },
    {
      label: "Top genre",
      value: topGenre,
      hint: `${formatNumber(topGenreN)} games`,
      icon: Globe,
      accent: "text-pink-400",
    },
    {
      label: "Delisted",
      value: formatNumber(dead),
      hint: `${total ? ((dead / total) * 100).toFixed(1) : 0}% of catalog`,
      icon: WifiOff,
      accent: "text-rose-400",
    },
  ];
}

export function KpiCards({ records, lastUpdated }: Props) {
  const kpis = useMemo(() => computeKpis(records, lastUpdated), [records, lastUpdated]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => (
        <Card key={k.label} className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{k.label}</span>
              <k.icon className={`h-4 w-4 ${k.accent ?? ""}`} />
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">{k.value}</div>
            {k.hint && (
              <div className="mt-1 truncate text-xs text-muted-foreground">{k.hint}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
