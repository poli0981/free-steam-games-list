import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Languages, Globe2 } from "lucide-react";
import { AuthPanel } from "../components/auth/AuthPanel";
import { DeviceFlowPanel } from "../components/auth/DeviceFlowPanel";
import { GpgPanel } from "../components/auth/GpgPanel";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { useAuth } from "../stores/auth";
import { getRateLimit, type RateLimit } from "../lib/github-api";
import { formatNumber } from "../lib/utils";
import {
  SUPPORTED_LANGUAGES,
  setLanguage,
  currentLanguage,
  type SupportedLanguage,
} from "../i18n";

const LANG_LABELS: Record<SupportedLanguage, { native: string; en: string; flag: string }> = {
  en: { native: "English", en: "English", flag: "🇺🇸" },
  vi: { native: "Tiếng Việt", en: "Vietnamese", flag: "🇻🇳" },
};

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const [rate, setRate] = useState<RateLimit | null>(null);
  const [lang, setLang] = useState<SupportedLanguage>(currentLanguage());

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

  // Keep local state in sync if i18n switches via another path.
  useEffect(() => {
    const handler = () => setLang(currentLanguage());
    i18n.on("languageChanged", handler);
    return () => i18n.off("languageChanged", handler);
  }, [i18n]);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Languages className="h-4 w-4" /> {t("settings.languageTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("settings.languageHint")}</p>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_LANGUAGES.map((code) => {
              const meta = LANG_LABELS[code];
              const active = lang === code;
              return (
                <Button
                  key={code}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setLanguage(code);
                    setLang(code);
                  }}
                >
                  <span className="mr-1.5">{meta.flag}</span>
                  {meta.native}
                  {!active && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      · {meta.en}
                    </span>
                  )}
                </Button>
              );
            })}
            <span className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Globe2 className="h-3 w-3" /> {t("system.autoDetectedLanguage")}
            </span>
          </div>
        </CardContent>
      </Card>

      <AuthPanel />

      {!auth.isAuthenticated && <DeviceFlowPanel />}

      {auth.isAuthenticated && <GpgPanel />}

      {auth.isAuthenticated && rate && (
        <Card>
          <CardHeader>
            <CardTitle>{t("system.apiRateLimitTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t("system.apiRateLimitRemaining")}
                </div>
                <div className="text-xl font-semibold">{formatNumber(rate.remaining)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t("system.apiRateLimitLimit")}
                </div>
                <div className="text-xl font-semibold">{formatNumber(rate.limit)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t("system.apiRateLimitResets")}
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
