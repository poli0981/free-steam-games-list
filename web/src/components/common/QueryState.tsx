import { Loader2, AlertTriangle, WifiOff, RotateCw, Bug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { REPORT_ISSUE_URL } from "../../pages/errors/ErrorPage";

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label ?? t("common.loading")}
      </div>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  // Shard fetch failed while the browser knows it's offline → say that
  // instead of a generic failure; cached data may still serve elsewhere.
  const offline = !navigator.onLine;
  const Icon = offline ? WifiOff : AlertTriangle;
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div
        className={
          offline
            ? "max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center"
            : "max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center"
        }
      >
        <Icon
          className={
            offline
              ? "mx-auto mb-3 h-8 w-8 text-amber-400"
              : "mx-auto mb-3 h-8 w-8 text-destructive"
          }
        />
        <h2 className="mb-1 text-lg font-semibold">
          {offline ? t("errors.offline.title") : t("system.failedToLoadData")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {offline ? t("errors.offline.description") : error.message}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onRetry ?? (() => window.location.reload())}
          >
            <RotateCw className="mr-1 h-3.5 w-3.5" />
            {t("errors.actions.retry")}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={REPORT_ISSUE_URL} target="_blank" rel="noreferrer">
              <Bug className="mr-1 h-3.5 w-3.5" />
              {t("errors.actions.report")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="rounded-lg border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">
          {description ?? t("system.comingInPhase23")}
        </p>
      </div>
    </div>
  );
}
