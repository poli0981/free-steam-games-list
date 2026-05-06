import { useGames } from "../hooks/useGames";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { TopOnlineBar } from "../components/charts/TopOnlineBar";
import { LoadingState, ErrorState } from "../components/common/QueryState";

export function TopOnlinePage() {
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Top online</h1>
        <p className="text-sm text-muted-foreground">
          Top 50 currently most-played online F2P titles.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Current players · top 50</CardTitle>
        </CardHeader>
        <CardContent>
          <TopOnlineBar records={q.data.records} limit={50} height={1100} />
        </CardContent>
      </Card>
    </div>
  );
}
