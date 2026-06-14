import { useState } from "react";
import { Github, Copy, Loader2, ExternalLink, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { useAuth } from "../../stores/auth";
import {
  isOAuthConfigured,
  requestDeviceCode,
  pollAccessToken,
  type DeviceCodeResponse,
} from "../../lib/oauth-device";
import { openExternal } from "../../lib/external-open";
import { toast } from "sonner";

/**
 * Device Flow as a sibling to the PAT entry. Hidden entirely when the
 * maintainer hasn't configured CLIENT_ID — see lib/oauth-device.ts for
 * the setup checklist.
 */
export function DeviceFlowPanel() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<DeviceCodeResponse | null>(null);

  if (!isOAuthConfigured()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-4 w-4" /> OAuth Device Flow
            <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase text-amber-400">
              not configured
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Device Flow lets visitors authorise the app without copying a PAT.
            Setup is one-time on the maintainer's side:
          </p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>
              Register an OAuth App at{" "}
              <a
                href="https://github.com/settings/developers"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                github.com/settings/developers
              </a>{" "}
              and tick <em>Enable Device Flow</em>.
            </li>
            <li>
              Set <code>VITE_GH_OAUTH_CLIENT_ID</code> at build time (e.g. as a
              GitHub Actions secret picked up by <code>deploy-pages.yml</code>).
            </li>
            <li>
              For browser callers, also set <code>VITE_GH_OAUTH_PROXY</code> to
              a CORS-permissive proxy (the desktop build hits github.com
              directly and doesn't need this).
            </li>
            <li>Re-deploy. This card flips into the active flow below.</li>
          </ol>
          <p className="text-xs">
            Until then, the PAT panel above is the canonical sign-in path.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function start() {
    setBusy(true);
    try {
      const dc = await requestDeviceCode();
      setCode(dc);
      // Open verification page automatically (system browser under Tauri).
      void openExternal(dc.verification_uri);
      toast.success("Device code generated", {
        description: `Enter ${dc.user_code} on the GitHub page that just opened.`,
      });
      void poll(dc);
    } catch (err) {
      toast.error("Couldn't start Device Flow", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function poll(dc: DeviceCodeResponse) {
    const start = Date.now();
    let interval = dc.interval * 1000;
    while (Date.now() - start < dc.expires_in * 1000) {
      await new Promise((r) => setTimeout(r, interval));
      try {
        const a = await pollAccessToken(dc.device_code);
        if (a.status === "ok" && a.token) {
          await auth.signIn(a.token);
          toast.success("Signed in via Device Flow", {
            description: "Token saved in localStorage. Edits unlocked.",
          });
          setCode(null);
          return;
        }
        if (a.status === "slow_down" && a.intervalSec)
          interval = a.intervalSec * 1000;
        if (a.status === "denied") {
          toast.error("Authorization denied");
          setCode(null);
          return;
        }
        if (a.status === "expired") {
          toast.error("Code expired — try again");
          setCode(null);
          return;
        }
      } catch (err) {
        toast.error("Polling failed", {
          description: err instanceof Error ? err.message : String(err),
        });
        setCode(null);
        return;
      }
    }
    toast.error("Code expired");
    setCode(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-4 w-4" /> OAuth Device Flow
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {code ? (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 text-center">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                User code
              </div>
              <div className="mt-1 inline-flex items-center gap-2 font-mono text-2xl font-semibold tracking-widest">
                {code.user_code}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    void navigator.clipboard.writeText(code.user_code);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Paste it on{" "}
                <a
                  href={code.verification_uri}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {code.verification_uri.replace(/^https?:\/\//, "")}
                </a>{" "}
                <ExternalLink className="inline h-3 w-3" />.
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting for you to authorise on GitHub… this card will refresh
              automatically.
            </div>
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              Code expires in {Math.floor(code.expires_in / 60)} min. Polling
              every {code.interval}s.
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Click below to generate a one-time code, paste it on GitHub, and
              you're signed in. No PAT to manage. Tokens revocable from{" "}
              <a
                href="https://github.com/settings/applications"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Authorized OAuth Apps
              </a>
              .
            </p>
            <Button onClick={start} disabled={busy}>
              <Github className="mr-1 h-3 w-3" />
              {busy ? "Starting…" : "Authorize via GitHub"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
