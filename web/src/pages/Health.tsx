import { useMemo, useState } from "react";
import { toast } from "sonner";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useGames } from "../hooks/useGames";
import { useAuth } from "../stores/auth";
import { LoadingState, ErrorState } from "../components/common/QueryState";
import { dispatchWorkflow } from "../lib/github-api";
import { isEmpty } from "../lib/data-store";
import type { GameRecord } from "../lib/schema";
import { formatNumber, formatRelativeDate } from "../lib/utils";

interface IssueGroup {
  label: string;
  description: string;
  records: GameRecord[];
  icon: React.ComponentType<{ className?: string }>;
  variant: "warning" | "destructive" | "secondary";
}

function gatherIssues(records: GameRecord[]): IssueGroup[] {
  const delisted: GameRecord[] = [];
  const stale: GameRecord[] = [];
  const missingManual: GameRecord[] = [];
  const onlineNoKernelInfo: GameRecord[] = [];

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

    if (r.type_game === "online" && r.is_kernel_ac == null && (r.anti_cheat ?? "-") !== "-") {
      onlineNoKernelInfo.push(r);
    }
  }

  return [
    {
      label: "Delisted",
      description: "Marked status=delisted (Steam page returned 404 / not free / blocked).",
      records: delisted,
      icon: Trash2,
      variant: "destructive",
    },
    {
      label: "Stale (> 30 days)",
      description: "last_updated is older than 30 days — daily pipeline may have skipped these.",
      records: stale,
      icon: Calendar,
      variant: "warning",
    },
    {
      label: "Missing manual fields",
      description: "Missing one or more of: genre / type_game / safe.",
      records: missingManual,
      icon: AlertTriangle,
      variant: "warning",
    },
    {
      label: "Online + AC + kernel unknown",
      description: "type_game=online with an anti-cheat name set but is_kernel_ac is null.",
      records: onlineNoKernelInfo,
      icon: HeartPulse,
      variant: "secondary",
    },
  ];
}

export function HealthPage() {
  const q = useGames();
  const auth = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const issues = useMemo(() => (q.data ? gatherIssues(q.data.records) : []), [q.data]);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  const totalIssues = issues.reduce((sum, g) => sum + g.records.length, 0);

  async function trigger(name: string, file: string) {
    if (!auth.token) {
      toast.error("Sign in first");
      return;
    }
    setBusy(file);
    try {
      await dispatchWorkflow(file, auth.token);
      toast.success(`Triggered ${name}`, {
        description: file,
        action: {
          label: "View runs",
          onClick: () =>
            window.open(
              `https://github.com/poli0981/free-steam-games-list/actions/workflows/${file}`,
              "_blank",
            ),
        },
      });
    } catch (err) {
      toast.error(`${name} failed`, {
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
          <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
          <p className="text-sm text-muted-foreground">
            Validation badges + maintenance triggers. Issues add up to{" "}
            <strong>{formatNumber(totalIssues)}</strong> records flagged across{" "}
            {issues.length} categories.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {issues.map((g) => (
          <Card key={g.label}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <g.icon className="h-4 w-4" /> {g.label}
                </span>
                <Badge variant={g.variant}>{formatNumber(g.records.length)}</Badge>
              </CardTitle>
              <CardDescription className="text-xs">{g.description}</CardDescription>
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
                      +{g.records.length - 30} more…
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
            <Sparkles className="h-4 w-4" /> Maintenance triggers
          </CardTitle>
          <CardDescription>
            Manually fire the existing GitHub Actions workflows. Requires sign-in with
            <code className="mx-1 rounded bg-muted px-1">workflow</code> scope.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <TriggerButton
            label="Update JSON"
            description="Full metadata refresh"
            file="update-json.yml"
            icon={RefreshCcw}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("Update JSON", "update-json.yml")}
          />
          <TriggerButton
            label="Update reviews"
            description="Reviews-only refresh"
            file="update-reviews.yml"
            icon={RefreshCcw}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("Update reviews", "update-reviews.yml")}
          />
          <TriggerButton
            label="Top online"
            description="Player leaderboard"
            file="top-online.yml"
            icon={Trophy}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("Top online", "top-online.yml")}
          />
          <TriggerButton
            label="Check dead links"
            description="HEAD scan all app pages"
            file="check-dead-links.yml"
            icon={LinkIcon}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("Check dead links", "check-dead-links.yml")}
          />
          <TriggerButton
            label="Purge unhealthy"
            description="Remove delisted/blocked"
            file="purge-unhealthy.yml"
            icon={Trash2}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("Purge unhealthy", "purge-unhealthy.yml")}
          />
          <TriggerButton
            label="Generate tables"
            description="Regenerate markdown"
            file="update-daily.yml"
            icon={Sparkles}
            busy={busy}
            disabled={!auth.isAuthenticated}
            onClick={() => trigger("Generate tables", "update-daily.yml")}
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
