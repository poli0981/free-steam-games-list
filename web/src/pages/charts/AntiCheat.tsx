import { useGames } from "../../hooks/useGames";
import { AntiCheatStacked } from "../../components/charts/AntiCheatStacked";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function AntiCheatPage() {
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Anti-cheat</h1>
        <p className="text-sm text-muted-foreground">
          Distribution of kernel-level / user-mode / no anti-cheat across the top 18 genres.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Anti-cheat by genre</CardTitle>
        </CardHeader>
        <CardContent>
          <AntiCheatStacked records={q.data.records} height={560} />
        </CardContent>
      </Card>
    </div>
  );
}
