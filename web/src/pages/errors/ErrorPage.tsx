import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ShieldX,
  FileQuestion,
  TimerOff,
  ServerCrash,
  Network,
  CloudOff,
  Hourglass,
  WifiOff,
  Home,
  RotateCw,
  Bug,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

/**
 * Shared error page for SPA-level errors. GitHub Pages can't serve real
 * per-status error documents (only 404.html), so 403/419/5xx here are
 * app-level: rendered by the router (#/error/:code), the route ErrorBoundary
 * (500/503), or deep links. Kept in the EAGER bundle on purpose — the error
 * UI must not live in a lazy chunk, or a chunk-load failure couldn't render
 * its own error page.
 */

export const ERROR_CODES = [
  "403",
  "404",
  "419",
  "500",
  "502",
  "503",
  "504",
  "offline",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const META: Record<ErrorCode, { icon: LucideIcon; tone: "neutral" | "warn" | "destructive" }> = {
  "403": { icon: ShieldX, tone: "warn" },
  "404": { icon: FileQuestion, tone: "neutral" },
  "419": { icon: TimerOff, tone: "warn" },
  "500": { icon: ServerCrash, tone: "destructive" },
  "502": { icon: Network, tone: "destructive" },
  "503": { icon: CloudOff, tone: "destructive" },
  "504": { icon: Hourglass, tone: "destructive" },
  offline: { icon: WifiOff, tone: "warn" },
};

export const REPORT_ISSUE_URL =
  "https://github.com/poli0981/free-steam-games-list/issues/new";

interface Props {
  code: ErrorCode;
  /** Optional technical detail line (error message, hint). */
  detail?: string;
}

export function ErrorPage({ code, detail }: Props) {
  const { t } = useTranslation();
  useDocumentTitle(`errors.${code}.title`);
  const { icon: Icon, tone } = META[code];
  const toneCls =
    tone === "destructive"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
        : "border-border bg-card text-muted-foreground";
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className={`max-w-md rounded-lg border p-8 text-center ${toneCls}`}>
        <Icon className="mx-auto mb-4 h-10 w-10" />
        <p className="font-mono text-xs tracking-widest opacity-70">
          {code === "offline" ? t("errors.offline.badge") : t("errors.code", { code })}
        </p>
        <h1 className="mb-2 mt-1 text-xl font-semibold text-foreground">
          {t(`errors.${code}.title`)}
        </h1>
        <p className="text-sm text-muted-foreground">{t(`errors.${code}.description`)}</p>
        {detail && (
          <p className="mt-2 break-words font-mono text-xs text-muted-foreground/70">
            {detail}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild size="sm">
            <Link to="/">
              <Home className="mr-1 h-3.5 w-3.5" />
              {t("errors.actions.home")}
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            <RotateCw className="mr-1 h-3.5 w-3.5" />
            {t("errors.actions.reload")}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={REPORT_ISSUE_URL} target="_blank" rel="noreferrer">
              <Bug className="mr-1 h-3.5 w-3.5" />
              {t("errors.actions.report")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
