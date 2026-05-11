import { useTranslation } from "react-i18next";
import { useGames } from "../../hooks/useGames";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { ReleaseYearHistogram } from "../../components/charts/ReleaseYearHistogram";
import { AddedCumulativeLine } from "../../components/charts/AddedCumulativeLine";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function TimePage() {
  const { t } = useTranslation();
  useDocumentTitle("charts.time.title");
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("charts.time.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("charts.time.subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("charts.time.releasesByYear")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ReleaseYearHistogram records={q.data.records} height={400} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("charts.time.catalogGrowth")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AddedCumulativeLine records={q.data.records} height={400} />
        </CardContent>
      </Card>
    </div>
  );
}
