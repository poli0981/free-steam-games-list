import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";

/**
 * Per-locale lazy loading. `en` stays statically bundled — it is the
 * fallbackLng, so a missing key can never render raw (a lazy fallback that
 * failed to fetch would). Every other locale is a dynamic import that only
 * the users of that language download (~6 KB gz each off everyone else's
 * critical path).
 *
 * `f2p:lang` in localStorage is the canonical override. If absent we fall
 * back to the browser language detector (navigator.language → ...).
 *
 * main.tsx awaits initI18n() before rendering, so render-time t() always
 * happens post-init — no flash of raw keys.
 */
export const SUPPORTED_LANGUAGES = ["en", "vi"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const loaders: Record<SupportedLanguage, () => Promise<{ default: object }>> = {
  en: () => Promise.resolve({ default: en }),
  vi: () => import("./locales/vi.json"),
};

function isSupported(lang: string): lang is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang);
}

/**
 * Mirror of the LanguageDetector order (localStorage "f2p:lang" → navigator
 * → en) so we can preload the right bundle BEFORE init. If the two ever
 * diverged, worst case is an en-fallback render until setLanguage runs —
 * never raw keys.
 */
function detectInitialLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem("f2p:lang");
    if (stored && isSupported(stored)) return stored;
  } catch {
    /* storage blocked → fall through to navigator */
  }
  for (const nav of navigator.languages ?? [navigator.language]) {
    const base = nav?.slice(0, 2).toLowerCase();
    if (base && isSupported(base)) return base;
  }
  return "en";
}

async function ensureBundle(lang: SupportedLanguage): Promise<void> {
  if (i18n.hasResourceBundle(lang, "translation")) return;
  const data = await loaders[lang]();
  i18n.addResourceBundle(lang, "translation", data.default, true, true);
}

export async function initI18n(): Promise<void> {
  const initial = detectInitialLanguage();
  const resources: Record<string, { translation: object }> = {
    en: { translation: en },
  };
  if (initial !== "en") {
    try {
      const data = await loaders[initial]();
      resources[initial] = { translation: data.default };
    } catch {
      // Network failure on first load → render with en fallback; the bundle
      // is retried on the next language switch via ensureBundle.
    }
  }
  await i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: "en",
      supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: "f2p:lang",
        caches: ["localStorage"],
      },
    });
  // index.html hardcodes lang="vi" — keep <html lang> in sync for a11y/SEO.
  document.documentElement.lang = i18n.resolvedLanguage ?? initial;
  i18n.on("languageChanged", (lang) => {
    document.documentElement.lang = lang;
  });
}

export default i18n;

/** Loads the locale bundle BEFORE switching — no flash of raw keys. */
export async function setLanguage(lang: SupportedLanguage): Promise<void> {
  await ensureBundle(lang);
  await i18n.changeLanguage(lang);
}

export function currentLanguage(): SupportedLanguage {
  const cur = i18n.resolvedLanguage ?? i18n.language ?? "en";
  return isSupported(cur) ? cur : "en";
}
