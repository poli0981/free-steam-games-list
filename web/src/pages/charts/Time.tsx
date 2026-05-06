import { useGames } from "../../hooks/useGames";
import { ReleaseYearHistogram } from "../../components/charts/ReleaseYearHistogram";
import { AddedCumulativeLine } from "../../components/charts/AddedCumulativeLine";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function TimePage() {
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Time</h1>
        <p className="text-sm text-muted-foreground">
          Release-year histogram of the catalog, plus a cumulative timeline of how the dataset grew.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Releases by year</CardTitle>
        </CardHeader>
        <CardContent>
          <ReleaseYearHistogram records={q.data.records} height={400} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Catalog growth (added_at)</CardTitle>
        </CardHeader>
        <CardContent>
          <AddedCumulativeLine records={q.data.records} height={400} />
        </CardContent>
      </Card>
    </div>
  );
}
