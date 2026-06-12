import { useTranslation } from "react-i18next";
import { useGames } from "../../hooks/useGames";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { PlatformsDonut } from "../../components/charts/PlatformsDonut";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function PlatformsPage() {
  const { t } = useTranslation();
  useDocumentTitle("charts.platforms.title");
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("charts.platforms.title")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t("charts.platforms.platformSupport")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlatformsDonut records={q.data.records} height={520} />
        </CardContent>
      </Card>
    </div>
  );
}
