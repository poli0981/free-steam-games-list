import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Gamepad2,
  BarChart3,
  Trophy,
  ShieldAlert,
  RefreshCw,
  Languages as LanguagesIcon,
  ArrowRight,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { useWelcome } from "../stores/welcome";
import { useGames } from "../hooks/useGames";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { SUPPORTED_LANGUAGES, setLanguage, currentLanguage } from "../i18n";
import { LEGAL_DOCS } from "../lib/legal";
import { cn, formatNumber } from "../lib/utils";

const LANG_LABEL: Record<string, string> = { en: "English", vi: "Tiếng Việt" };

/**
 * First-run introduction, shown AFTER the legal gate.
 *
 * Kept deliberately short: what the data is, how honest it is, how fresh it is,
 * and three ways in. It does not block on the dataset — the counts fill in if
 * useGames already has them, and their absence never delays the first paint.
 */
export function WelcomePage() {
  const { t } = useTranslation();
  useDocumentTitle("welcome.title");
  const navigate = useNavigate();
  const markSeen = useWelcome((s) => s.markSeen);
  const q = useGames();
  const lang = currentLanguage();

  const total = q.data?.records.length;
  const lastUpdated = q.data?.index.last_updated?.slice(0, 10);

  function enter(to: string) {
    markSeen();
    navigate(to);
  }

  const entries = [
    { to: "/games", icon: Gamepad2, key: "browse" },
    { to: "/charts/genres", icon: BarChart3, key: "charts" },
    { to: "/top-online", icon: Trophy, key: "leaderboards" },
  ] as const;

  return (
    <div className="mx-auto max-w-3xl space-y-10 py-4">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t("welcome.heading")}</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          {/* formatNumber, not i18next's raw {{count}} — otherwise this reads
              "3424 games" while the topbar two lines above says "3,424". */}
          {total
            ? t("welcome.introWithCount", { total: formatNumber(total) })
            : t("welcome.intro")}
        </p>
      </header>

      {/* The honest framing the project already takes in docs/DISCLAIMER.md.
          Putting it up front is the point of the page — someone should know
          what this list is and is not before they rely on it. */}
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4 text-amber-400" />
          {t("welcome.honestTitle")}
        </h2>
        <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <li>• {t("welcome.honest1")}</li>
          <li>• {t("welcome.honest2")}</li>
          <li>• {t("welcome.honest3")}</li>
        </ul>
      </section>

      <section className="flex items-start gap-3 text-sm text-muted-foreground">
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          {t("welcome.freshness")}
          {lastUpdated ? ` ${t("welcome.lastUpdated", { date: lastUpdated })}` : ""}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t("welcome.startHere")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {entries.map(({ to, icon: Icon, key }) => (
            <button
              key={to}
              type="button"
              onClick={() => enter(to)}
              className="group rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            >
              <Icon className="mb-2 h-5 w-5 text-primary" />
              <div className="text-sm font-medium">{t(`welcome.entry.${key}.title`)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t(`welcome.entry.${key}.body`)}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          <LanguagesIcon className="h-3.5 w-3.5" />
          {t("welcome.language")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_LANGUAGES.map((code) => (
            <Button
              key={code}
              size="sm"
              variant={lang === code ? "default" : "outline"}
              onClick={() => void setLanguage(code)}
            >
              {LANG_LABEL[code] ?? code}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t("welcome.paperwork")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("welcome.paperworkBody")}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {LEGAL_DOCS.filter((d) => d.consent).map((d) => (
            <li key={d.path}>
              <a
                href={`/legal/${d.path.replace(/^docs\//, "").replace(/\.md$/, "").toLowerCase()}`}
                onClick={(e) => {
                  // The in-app /legal/* routes do not exist yet; until they do,
                  // keep the user on the About page rather than 404-ing them.
                  e.preventDefault();
                  enter("/about");
                }}
                className="text-primary underline-offset-4 hover:underline"
              >
                {d.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <div className={cn("flex flex-wrap items-center gap-3 border-t border-border pt-6")}>
        <Button onClick={() => enter("/")}>
          {t("welcome.continue")}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground">{t("welcome.reshowHint")}</span>
      </div>
    </div>
  );
}
