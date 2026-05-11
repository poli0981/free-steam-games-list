import { useTranslation } from "react-i18next";
import { useGames } from "../../hooks/useGames";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { GenreTreemap } from "../../components/charts/GenreTreemap";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function GenresPage() {
  const { t } = useTranslation();
  useDocumentTitle("charts.genres.title");
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("charts.genres.title")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t("charts.genres.distribution")}</CardTitle>
        </CardHeader>
        <CardContent>
          <GenreTreemap records={q.data.records} height={640} />
        </CardContent>
      </Card>
    </div>
  );
}
