import { useEffect, useState } from "react";
import { AuthPanel } from "../components/auth/AuthPanel";
import { GpgPanel } from "../components/auth/GpgPanel";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../stores/auth";
import { getRateLimit, type RateLimit } from "../lib/github-api";
import { formatNumber } from "../lib/utils";

export function SettingsPage() {
  const auth = useAuth();
  const [rate, setRate] = useState<RateLimit | null>(null);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setRate(null);
      return;
    }
    let cancelled = false;
    getRateLimit(auth.token).then((r) => {
      if (!cancelled) setRate(r);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.isAuthenticated, auth.token]);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Authentication, theme, and preferences.
        </p>
      </div>

      <AuthPanel />

      {auth.isAuthenticated && <GpgPanel />}

      {auth.isAuthenticated && rate && (
        <Card>
          <CardHeader>
            <CardTitle>API rate limit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Remaining
                </div>
                <div className="text-xl font-semibold">{formatNumber(rate.remaining)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Limit
                </div>
                <div className="text-xl font-semibold">{formatNumber(rate.limit)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Resets
                </div>
                <div className="text-xl font-semibold">
                  {new Date(rate.reset * 1000).toLocaleTimeString()}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
