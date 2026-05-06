import { useGames } from "../../hooks/useGames";
import { GenreTreemap } from "../../components/charts/GenreTreemap";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function GenresPage() {
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Genres</h1>
      <Card>
        <CardHeader>
          <CardTitle>Genre distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <GenreTreemap records={q.data.records} height={640} />
        </CardContent>
      </Card>
    </div>
  );
}
