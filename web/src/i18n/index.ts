import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import vi from "./locales/vi.json";

/**
 * Single resource bundle ships with the app — no async loading. Two
 * languages right now (en, vi); easy to add more by copying en.json and
 * registering it below.
 *
 * `f2p:lang` in localStorage is the canonical override. If absent we fall
 * back to the browser language detector (navigator.language → ...).
 */
export const SUPPORTED_LANGUAGES = ["en", "vi"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      vi: { translation: vi },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "f2p:lang",
      caches: ["localStorage"],
    },
  });

export default i18n;

export function setLanguage(lang: SupportedLanguage): void {
  void i18n.changeLanguage(lang);
}

export function currentLanguage(): SupportedLanguage {
  const cur = i18n.resolvedLanguage ?? i18n.language ?? "en";
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(cur)
    ? (cur as SupportedLanguage)
    : "en";
}
