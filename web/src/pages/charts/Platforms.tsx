import { useGames } from "../../hooks/useGames";
import { PlatformsDonut } from "../../components/charts/PlatformsDonut";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function PlatformsPage() {
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Platforms</h1>
      <Card>
        <CardHeader>
          <CardTitle>Platform support</CardTitle>
        </CardHeader>
        <CardContent>
          <PlatformsDonut records={q.data.records} height={520} />
        </CardContent>
      </Card>
    </div>
  );
}
