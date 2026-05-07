import { useTranslation } from "react-i18next";
import { useGames } from "../../hooks/useGames";
import { LanguagesHeatmap } from "../../components/charts/LanguagesHeatmap";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function LanguagesPage() {
  const { t } = useTranslation();
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("charts.languages.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("charts.languages.subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("charts.languages.languageCoverage")}</CardTitle>
        </CardHeader>
        <CardContent>
          <LanguagesHeatmap records={q.data.records} height={600} />
        </CardContent>
      </Card>
    </div>
  );
}
