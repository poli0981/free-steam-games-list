import { useGames } from "../hooks/useGames";
import { KpiCards } from "../components/charts/KpiCards";
import { GenreTreemap } from "../components/charts/GenreTreemap";
import { PlatformsDonut } from "../components/charts/PlatformsDonut";
import { TopOnlineBar } from "../components/charts/TopOnlineBar";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { LoadingState, ErrorState } from "../components/common/QueryState";

export function Dashboard() {
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  const { records, index } = q.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of {records.length.toLocaleString()} F2P Steam games tracked in this
          repository.
        </p>
      </div>

      <KpiCards records={records} lastUpdated={index.last_updated} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top online (current players)</CardTitle>
          </CardHeader>
          <CardContent>
            <TopOnlineBar records={records} limit={20} height={520} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platforms</CardTitle>
          </CardHeader>
          <CardContent>
            <PlatformsDonut records={records} height={520} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Genre distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <GenreTreemap records={records} height={460} />
        </CardContent>
      </Card>
    </div>
  );
}
