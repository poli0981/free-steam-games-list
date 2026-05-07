import { useTranslation } from "react-i18next";
import { useGames } from "../../hooks/useGames";
import { TagsWordCloud } from "../../components/charts/TagsWordCloud";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function TagsPage() {
  const { t } = useTranslation();
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("charts.tags.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("charts.tags.subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("charts.tags.tagCloud")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TagsWordCloud records={q.data.records} height={560} />
        </CardContent>
      </Card>
    </div>
  );
}
