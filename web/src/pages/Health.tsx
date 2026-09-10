import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Trash2,
  HeartPulse,
  Calendar,
  ShieldQuestion,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { useGames } from "../hooks/useGames";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { LoadingState, ErrorState } from "../components/common/QueryState";
import { isEmpty } from "../lib/data-store";
import type { GameRecord } from "../lib/schema";
import { formatNumber, formatRelativeDate } from "../lib/utils";

interface IssueGroup {
  /** i18n key suffix under `health.group{Suffix}` for label, `Desc` for description. */
  key: "Delisted" | "Stale" | "Missing" | "Kernel" | "OnlineAcUnknown";
  records: GameRecord[];
  icon: React.ComponentType<{ className?: string }>;
  variant: "warning" | "destructive" | "secondary";
}

function gatherIssues(records: GameRecord[]): IssueGroup[] {
  const delisted: GameRecord[] = [];
  const stale: GameRecord[] = [];
  const missingManual: GameRecord[] = [];
  const onlineNoKernelInfo: GameRecord[] = [];
  const onlineAcUnknown: GameRecord[] = [];

  const NOW = Date.now();
  const STALE_DAYS = 30;

  for (const r of records) {
    if (r.status === "delisted") delisted.push(r);

    if (r.last_updated) {
      const t = new Date(r.last_updated).getTime();
      if (!Number.isNaN(t) && (NOW - t) / 86_400_000 > STALE_DAYS) {
        stale.push(r);
      }
    }

    if (isEmpty(r.genre) || isEmpty(r.type_game) || isEmpty(r.safe)) {
      missingManual.push(r);
    }

    const ac = (r.anti_cheat ?? "").trim();
    const acIsBlank = ac === "" || ac === "-";

    if (r.type_game === "online" && r.is_kernel_ac == null && !acIsBlank) {
      onlineNoKernelInfo.push(r);
    }

    if (r.type_game === "online" && acIsBlank) {
      onlineAcUnknown.push(r);
    }
  }

  return [
    { key: "Delisted", records: delisted, icon: Trash2, variant: "destructive" },
    { key: "Stale", records: stale, icon: Calendar, variant: "warning" },
    { key: "Missing", records: missingManual, icon: AlertTriangle, variant: "warning" },
    { key: "Kernel", records: onlineNoKernelInfo, icon: HeartPulse, variant: "secondary" },
    { key: "OnlineAcUnknown", records: onlineAcUnknown, icon: ShieldQuestion, variant: "warning" },
  ];
}

export function HealthPage() {
  const { t } = useTranslation();
  useDocumentTitle("health.title");
  const q = useGames();

  const issues = useMemo(() => (q.data ? gatherIssues(q.data.records) : []), [q.data]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;

  const totalIssues = issues.reduce((sum, g) => sum + g.records.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("health.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("health.subtitle", {
              total: formatNumber(totalIssues),
              categories: issues.length,
            })}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {issues.map((g) => (
          <Card key={g.key}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <g.icon className="h-4 w-4" /> {t(`health.group${g.key}`)}
                </span>
                <Badge variant={g.variant}>{formatNumber(g.records.length)}</Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                {t(`health.group${g.key}Desc`)}
              </CardDescription>
            </CardHeader>
            {g.records.length > 0 && (
              <CardContent>
                <div className="space-y-1 max-h-48 overflow-auto pr-1 text-sm scrollbar-thin">
                  {g.records.slice(0, 30).map((r) => (
                    <a
                      key={r.link}
                      href={`#/games?search=${encodeURIComponent(r.name)}`}
                      className="flex items-center justify-between rounded px-2 py-1 hover:bg-accent"
                    >
                      <span className="truncate">{r.name || "—"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatRelativeDate(r.last_updated)}
                      </span>
                    </a>
                  ))}
                  {g.records.length > 30 && (
                    <div className="px-2 text-xs text-muted-foreground">
                      {t("health.moreItems", { count: g.records.length - 30 })}
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

    </div>
  );
}
