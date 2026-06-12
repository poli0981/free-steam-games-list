import { useTranslation } from "react-i18next";
import { useGames } from "../hooks/useGames";
import { useRemovedGames } from "../hooks/useRemovedGames";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { KpiCards } from "../components/charts/KpiCards";
import { GenreTreemap } from "../components/charts/GenreTreemap";
import { PlatformsDonut } from "../components/charts/PlatformsDonut";
import { TopOnlineBar } from "../components/charts/TopOnlineBar";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { LoadingState, ErrorState } from "../components/common/QueryState";

export function Dashboard() {
  const { t } = useTranslation();
  useDocumentTitle("dashboard.title");
  const q = useGames();
  const removed = useRemovedGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;

  const { records, index } = q.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("dashboard.subtitle", { count: records.length })}
        </p>
      </div>

      <KpiCards
        records={records}
        lastUpdated={index.last_updated}
        removedCount={removed.data?.length}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("dashboard.topOnlineTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TopOnlineBar records={records} limit={20} height={520} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.platformsTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PlatformsDonut records={records} height={520} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.genreTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <GenreTreemap records={records} height={460} />
        </CardContent>
      </Card>
    </div>
  );
}
