import { useTranslation } from "react-i18next";
import { useGames } from "../hooks/useGames";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { TopOnlineBar } from "../components/charts/TopOnlineBar";
import { LoadingState, ErrorState } from "../components/common/QueryState";

export function TopOnlinePage() {
  const { t } = useTranslation();
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("topOnline.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("topOnline.subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("topOnline.cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TopOnlineBar records={q.data.records} limit={50} height={1100} />
        </CardContent>
      </Card>
    </div>
  );
}
