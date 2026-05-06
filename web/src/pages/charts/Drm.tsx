import { useGames } from "../../hooks/useGames";
import { DrmDlcBars } from "../../components/charts/DrmDlcBars";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { LoadingState, ErrorState } from "../../components/common/QueryState";

export function DrmPage() {
  const q = useGames();
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">DRM &amp; paid DLC</h1>
        <p className="text-sm text-muted-foreground">
          F2P shouldn&apos;t mean clean — many titles still ship with third-party DRM and/or
          paid DLC. This breakdown helps spot the &quot;truly free&quot; pool.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>DRM × paid-DLC breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <DrmDlcBars records={q.data.records} height={420} />
        </CardContent>
      </Card>
    </div>
  );
}
