import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  AlertTriangle,
  RefreshCcw,
  Trash2,
  Trophy,
  HeartPulse,
  Link as LinkIcon,
  Calendar,
  Sparkles,
  ShieldQuestion,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useGames } from "../hooks/useGames";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useAuth } from "../stores/auth";
import { LoadingState, ErrorState } from "../components/common/QueryState";
import { dispatchWorkflow } from "../lib/github-api";
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
  const auth = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const issues = useMemo(() => (q.data ? gatherIssues(q.data.records) : []), [q.data]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;

  const totalIssues = issues.reduce((sum, g) => sum + g.records.length, 0);

  async function trigger(nameKey: string, file: string) {
    const localizedName = t(nameKey);
    if (!auth.token) {
      toast.error(t("health.signInFirst"));
      return;
    }
    setBusy(file);
    try {
      await dispatchWorkflow(file, auth.token);
      toast.success(t("health.triggeredToast", { name: localizedName }), {
        description: file,
        action: {
          label: t("health.viewRuns"),
          onClick: () =>
            window.open(
              `https://github.com/poli0981/free-steam-games-list/actions/workflows/${file}`,
              "_blank",
            ),
        },
      });
    } catch (err) {
      toast.error(t("health.failedToast", { name: localizedName }), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> {t("health.maintenanceTriggers")}
          </CardTitle>
          <CardDescription>
            {t("health.maintenanceDesc", { scope: "workflow" })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <TriggerButton
            label={t("health.triggerUpdateJson")}
            description={t("health.triggerUpdateJsonDesc")}
            file="update-json.yml"
            icon={RefreshCcw}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("health.triggerUpdateJson", "update-json.yml")}
          />
          <TriggerButton
            label={t("health.triggerUpdateReviews")}
            description={t("health.triggerUpdateReviewsDesc")}
            file="update-reviews.yml"
            icon={RefreshCcw}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("health.triggerUpdateReviews", "update-reviews.yml")}
          />
          <TriggerButton
            label={t("health.triggerTopOnline")}
            description={t("health.triggerTopOnlineDesc")}
            file="top-online.yml"
            icon={Trophy}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("health.triggerTopOnline", "top-online.yml")}
          />
          <TriggerButton
            label={t("health.triggerTopOffline")}
            description={t("health.triggerTopOfflineDesc")}
            file="top-offline.yml"
            icon={Trophy}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("health.triggerTopOffline", "top-offline.yml")}
          />
          <TriggerButton
            label={t("health.triggerCheckLinks")}
            description={t("health.triggerCheckLinksDesc")}
            file="check-dead-links.yml"
            icon={LinkIcon}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("health.triggerCheckLinks", "check-dead-links.yml")}
          />
          <TriggerButton
            label={t("health.triggerPurge")}
            description={t("health.triggerPurgeDesc")}
            file="purge-unhealthy.yml"
            icon={Trash2}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("health.triggerPurge", "purge-unhealthy.yml")}
          />
          <TriggerButton
            label={t("health.triggerGenerate")}
            description={t("health.triggerGenerateDesc")}
            file="update-daily.yml"
            icon={Sparkles}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("health.triggerGenerate", "update-daily.yml")}
          />
        </CardContent>
      </Card>
    </div>
  );
}

interface TriggerProps {
  label: string;
  description: string;
  file: string;
  icon: React.ComponentType<{ className?: string }>;
  busy: string | null;
  disabled: boolean;
  onClick: () => void;
}

function TriggerButton({
  label,
  description,
  file,
  icon: Icon,
  busy,
  disabled,
  onClick,
}: TriggerProps) {
  const isBusy = busy === file;
  return (
    <Button
      variant="outline"
      className="h-auto justify-start py-3 text-left"
      disabled={disabled || isBusy}
      onClick={onClick}
    >
      <div className="flex w-full items-start gap-2">
        {isBusy ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium">{label}</div>
          <div className="text-xs font-normal text-muted-foreground">{description}</div>
        </div>
      </div>
    </Button>
  );
}
