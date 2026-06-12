import { useTranslation } from "react-i18next";
import { useGames } from "../../hooks/useGames";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { ReviewsHistogram } from "../../components/charts/ReviewsHistogram";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function ReviewsPage() {
  const { t } = useTranslation();
  useDocumentTitle("charts.reviews.title");
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("charts.reviews.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("charts.reviews.subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("charts.reviews.reviewDistribution")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ReviewsHistogram records={q.data.records} height={420} />
        </CardContent>
      </Card>
    </div>
  );
}
