import { useGames } from "../../hooks/useGames";
import { LanguagesHeatmap } from "../../components/charts/LanguagesHeatmap";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function LanguagesPage() {
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Languages</h1>
        <p className="text-sm text-muted-foreground">
          For each of the top 30 languages, how many games support it via interface, audio, and subtitles.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Language support coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <LanguagesHeatmap records={q.data.records} height={600} />
        </CardContent>
      </Card>
    </div>
  );
}
