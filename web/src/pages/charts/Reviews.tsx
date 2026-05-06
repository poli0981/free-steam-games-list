import { useGames } from "../../hooks/useGames";
import { ReviewsHistogram } from "../../components/charts/ReviewsHistogram";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function ReviewsPage() {
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Distribution of user-review percentages, binned by 10%.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Review % distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <ReviewsHistogram records={q.data.records} height={420} />
        </CardContent>
      </Card>
    </div>
  );
}
