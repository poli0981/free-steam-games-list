import { useEffect, useState } from "react";
import { Github, LogOut, ShieldCheck, AlertCircle, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";
import { useAuth } from "../../stores/auth";
import { REPO_OWNER, REPO_NAME } from "../../lib/schema";

export function AuthPanel() {
  const auth = useAuth();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (auth.token && !auth.user && !auth.isVerifying) {
      auth.hydrate();
    }
  }, [auth.token, auth.user, auth.isVerifying]);

  if (auth.isAuthenticated && auth.user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>GitHub authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <img
              src={auth.user.avatar_url}
              alt=""
              className="h-12 w-12 rounded-full border"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{auth.user.name ?? auth.user.login}</span>
                <Badge variant="success">
                  <ShieldCheck className="mr-1 h-3 w-3" /> {auth.permission ?? "write"}
                </Badge>
              </div>
              <a
                href={auth.user.html_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                @{auth.user.login}
              </a>
            </div>
            <Button variant="outline" size="sm" onClick={auth.signOut}>
              <LogOut className="mr-1 h-3 w-3" /> Sign out
            </Button>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p>
              Edits, adds, and deletes commit to{" "}
              <code className="rounded bg-muted px-1">
                {REPO_OWNER}/{REPO_NAME}
              </code>{" "}
              under your account. Classic PATs auto-sign commits as "Verified".
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    try {
      await auth.signIn(token.trim());
      setToken("");
    } catch {
      /* error already in auth.error */
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to GitHub</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Edit, add, or delete games requires a GitHub personal access token. Read-only
          browse works without sign-in.
        </p>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="pat">Personal access token</Label>
            <div className="flex gap-2">
              <Input
                id="pat"
                type={showToken ? "text" : "password"}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={auth.isVerifying}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowToken((s) => !s)}
              >
                {showToken ? "Hide" : "Show"}
              </Button>
            </div>
          </div>

          {auth.error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{auth.error}</span>
            </div>
          )}

          <Button type="submit" disabled={!token.trim() || auth.isVerifying}>
            <Github className="mr-1 h-3 w-3" />
            {auth.isVerifying ? "Verifying…" : "Sign in"}
          </Button>
        </form>

        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
          <p className="font-semibold">How to create a token</p>
          <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
            <li>
              Go to{" "}
              <a
                href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=F2P%20Tracker%20Web%20App"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Settings → Developer settings → Tokens (classic) <ExternalLink className="inline h-3 w-3" />
              </a>
            </li>
            <li>
              Select scopes: <code className="rounded bg-muted px-1">repo</code> and{" "}
              <code className="rounded bg-muted px-1">workflow</code>
            </li>
            <li>Set expiration (90 days recommended)</li>
            <li>Generate, copy, paste above</li>
          </ol>
          <p className="text-muted-foreground">
            <strong>Verified commits:</strong> Classic PATs sign commits via GitHub
            web-flow. Fine-grained PATs do not — but you can still edit, just without the
            "Verified" badge.
          </p>
          <p className="text-muted-foreground">
            <strong>Storage:</strong> Token is kept only in your browser&apos;s localStorage.
            Never sent anywhere except to <code>api.github.com</code>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
