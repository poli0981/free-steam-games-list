import { useTranslation } from "react-i18next";
import { useGames } from "../../hooks/useGames";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { PlayerTiersPie } from "../../components/charts/PlayerTiersPie";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function PlayersPage() {
  const { t } = useTranslation();
  useDocumentTitle("charts.players.title");
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("charts.players.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("charts.players.subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("charts.players.onlineTiers")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerTiersPie records={q.data.records} height={420} />
        </CardContent>
      </Card>
    </div>
  );
}
