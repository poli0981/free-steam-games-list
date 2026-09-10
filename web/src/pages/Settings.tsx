import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Languages, Globe2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useWelcome } from "../stores/welcome";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const resetWelcome = useWelcome((s) => s.reset);
  const { t, i18n } = useTranslation();
  useDocumentTitle("settings.title");
  const [lang, setLang] = useState<SupportedLanguage>(currentLanguage());

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
                    // Async: loads the locale bundle before switching. The
                    // languageChanged listener above re-syncs local state.
                    void setLanguage(code);
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> {t("settings.welcomeTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("settings.welcomeHint")}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // Clear the flag as well as navigating, so closing the page
              // without pressing Continue does not silently re-arm it.
              resetWelcome();
              navigate("/welcome");
            }}
          >
            {t("settings.welcomeAction")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
