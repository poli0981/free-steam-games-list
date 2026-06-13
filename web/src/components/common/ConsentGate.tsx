import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ScrollText, ExternalLink, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { useConsent } from "../../stores/consent";
import { CONSENT_DOCS, legalDocUrl } from "../../lib/legal";
import { isTauri, openExternal } from "../../lib/external-open";

/**
 * First-run legal consent gate. Blocks the main UI until the user accepts the
 * binding documents. Kept in the EAGER bundle (no lazy import) so it paints on
 * first render with no flash — i18n is already awaited before render in
 * main.tsx. Mounted INSIDE AppErrorBoundary + HashRouter, so a crash here is
 * caught by the top-level boundary and `useLocation` is available.
 *
 * Persistence + incognito behaviour live in stores/consent.ts.
 */
export function ConsentGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const accepted = useConsent((s) => s.accepted);
  const accept = useConsent((s) => s.accept);
  const location = useLocation();
  const [checked, setChecked] = useState(false);
  const [declined, setDeclined] = useState(false);

  // Let the error system through even before consent: a chunk-load 503 after a
  // mid-session deploy, the GitHub Pages 404.html redirect, or an #/error/:code
  // deep link must reach the user instead of being swallowed behind the gate.
  const isErrorRoute = location.pathname.startsWith("/error");

  if (accepted || isErrorRoute) return <>{children}</>;

  function handleDecline() {
    // Desktop: declining means you don't get the app — quit it. On web there's
    // nothing to quit, so show a blocking notice with a way back to the gate.
    if (isTauri()) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().close();
        } catch (err) {
          console.error("ConsentGate: failed to close window", err);
          setDeclined(true);
        }
      })();
    } else {
      setDeclined(true);
    }
  }

  if (declined) {
    return (
      <div className="flex min-h-screen items-center justify-center overflow-auto p-4">
        <div className="w-full max-w-md rounded-lg border border-amber-500/30 bg-amber-500/5 p-8 text-center">
          <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-amber-400" />
          <h1 className="mb-2 text-xl font-semibold text-foreground">
            {t("consent.declinedTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("consent.declinedBody")}</p>
          <div className="mt-6">
            <Button size="sm" onClick={() => setDeclined(false)}>
              {t("consent.back")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center overflow-auto p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-8 text-foreground">
        <ScrollText className="mb-4 h-10 w-10 text-primary" />
        <h1 className="text-xl font-semibold">{t("consent.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("consent.intro")}</p>

        <p className="mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("consent.docsLabel")}
        </p>
        <ul className="mt-2 space-y-1.5">
          {CONSENT_DOCS.map((d) => (
            <li key={d.path}>
              <button
                type="button"
                onClick={() => void openExternal(legalDocUrl(d.path))}
                className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="font-medium">{d.label}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>

        <label className="mt-6 flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
          />
          <span className="text-muted-foreground">{t("consent.checkboxLabel")}</span>
        </label>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button disabled={!checked} onClick={() => accept()}>
            {t("consent.continue")}
          </Button>
          <Button variant="ghost" onClick={handleDecline}>
            {t("consent.decline")}
          </Button>
        </div>
      </div>
    </div>
  );
}
