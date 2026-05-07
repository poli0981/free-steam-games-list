import { Loader2, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

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

export function ErrorState({ error }: { error: Error }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
        <h2 className="mb-1 text-lg font-semibold">{t("system.failedToLoadData")}</h2>
        <p className="text-sm text-muted-foreground">{error.message}</p>
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
