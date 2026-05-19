import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useRemovedGames } from "../../hooks/useRemovedGames";
import { DelistedTimeline } from "../../components/charts/DelistedTimeline";
import { DelistedReasonBreakdown } from "../../components/charts/DelistedReasonBreakdown";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function DelistedPage() {
  const { t } = useTranslation();
  useDocumentTitle("charts.delisted.title");
  const q = useRemovedGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("charts.delisted.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("charts.delisted.subtitle", { count: q.data.length })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("charts.delisted.timeline")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DelistedTimeline records={q.data} height={400} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("charts.delisted.breakdown")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DelistedReasonBreakdown records={q.data} height={360} />
        </CardContent>
      </Card>
    </div>
  );
}
