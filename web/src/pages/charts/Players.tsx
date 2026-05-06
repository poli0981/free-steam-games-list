import { useGames } from "../../hooks/useGames";
import { PlayerTiersPie } from "../../components/charts/PlayerTiersPie";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function PlayersPage() {
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Player tiers</h1>
        <p className="text-sm text-muted-foreground">
          Online F2P games bucketed by current concurrent players.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Online concurrent player tiers</CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerTiersPie records={q.data.records} height={420} />
        </CardContent>
      </Card>
    </div>
  );
}
