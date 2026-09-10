import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { CHART_PAGES } from "../../lib/chart-nav";

/**
 * Landing page for /charts. Replaces the previous redirect straight into
 * /charts/genres, which gave no sense of what else was available.
 */
export function ChartsIndexPage() {
  const { t } = useTranslation();
  useDocumentTitle("charts.indexTitle");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("charts.indexTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("charts.indexSubtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CHART_PAGES.map(({ to, i18n, desc, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-accent"
          >
            <Icon className="mb-2 h-5 w-5 text-primary" />
            <div className="text-sm font-medium">{t(i18n)}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(desc)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
