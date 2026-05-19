import { useTranslation } from "react-i18next";
import { useGames } from "../hooks/useGames";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { TopOfflineBar } from "../components/charts/TopOfflineBar";
import { LoadingState, ErrorState } from "../components/common/QueryState";

export function TopOfflinePage() {
  const { t } = useTranslation();
  useDocumentTitle("topOffline.title");
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("topOffline.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("topOffline.subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("topOffline.cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TopOfflineBar records={q.data.records} limit={100} height={1800} />
        </CardContent>
      </Card>
    </div>
  );
}
