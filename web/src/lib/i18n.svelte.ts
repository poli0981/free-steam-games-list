/**
 * Translation, without i18next.
 *
 * The React app used i18next + react-i18next + i18next-browser-languagedetector
 * — three dependencies and ~40 KB — to do four things: look up a dotted key,
 * interpolate `{{var}}`, pick `_one`/`_other` by count, and fall back to `en`.
 * Two locales and 353 keys do not need a library for that, and swapping in
 * Paraglide would have meant converting every key, which is 706 chances to
 * introduce a typo in text nobody proofreads.
 *
 * So: the locale JSON files are untouched, byte for byte, and this reads them.
 *
 * What is preserved from the old setup, deliberately:
 *   - `en` is statically bundled because it is the fallback. A lazily-fetched
 *     fallback that failed to load would render raw keys.
 *   - `vi` is a dynamic import, so its ~7 KB stays off everyone else's path.
 *   - Detection order is localStorage `f2p:lang` → navigator → `en`, matching
 *     what LanguageDetector was configured with.
 *   - `document.documentElement.lang` is kept in sync.
 */
import en from "../i18n/locales/en.json";

export const SUPPORTED_LANGUAGES = ["en", "vi"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "f2p:lang";

type Bundle = Record<string, unknown>;

const loaders: Record<SupportedLanguage, () => Promise<Bundle>> = {
  en: async () => en as Bundle,
  vi: async () => (await import("../i18n/locales/vi.json")).default as Bundle,
};

const bundles: Partial<Record<SupportedLanguage, Bundle>> = { en: en as Bundle };

function isSupported(lang: string): lang is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang);
}

export function detectInitialLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isSupported(stored)) return stored;
  } catch {
    /* storage blocked - fall through to navigator */
  }
  for (const nav of navigator.languages ?? [navigator.language]) {
    const base = nav?.slice(0, 2).toLowerCase();
    if (base && isSupported(base)) return base;
  }
  return "en";
}

/** Walk a dotted key. Returns undefined rather than throwing on a miss, so the
 *  caller can fall back to `en` and then to the key itself. */
function lookup(bundle: Bundle | undefined, key: string): unknown {
  if (!bundle) return undefined;
  let node: unknown = bundle;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * `{{name}}` substitution, matching i18next's default interpolation.
 *
 * A missing variable leaves the placeholder in place instead of printing
 * "undefined": a visible `{{count}}` is a bug report, whereas "undefined games"
 * looks like data.
 */
function interpolate(text: string, vars?: Record<string, unknown>): string {
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

class I18n {
  lang = $state<SupportedLanguage>("en");
  /** Bumped on every bundle load so `t()` callers re-run under $derived. */
  #revision = $state(0);

  get ready(): number {
    return this.#revision;
  }

  /**
   * Look up `key`, interpolating `vars`.
   *
   * `vars.count` additionally selects between `key_one` and `key_other` when
   * those exist. Only four keys in the catalogue use that, and all four belong
   * to the removed in-app editing feature — but the suffix convention is
   * i18next's and the JSON still carries it, so honouring it costs nothing and
   * avoids a silent miss if one is ever reused.
   */
  t = (key: string, vars?: Record<string, unknown>): string => {
    // Read the rune so Svelte tracks this call against a language change.
    void this.#revision;
    void this.lang;

    const count = vars?.count;
    const candidates =
      typeof count === "number"
        ? [count === 1 ? `${key}_one` : `${key}_other`, key]
        : [key];

    for (const candidate of candidates) {
      for (const source of [bundles[this.lang], bundles.en]) {
        const hit = lookup(source, candidate);
        if (typeof hit === "string") return interpolate(hit, vars);
      }
    }
    // The key itself, not an empty string: a visible "games.emptyState" in the
    // UI names the missing key, where "" is simply a blank space nobody
    // reports.
    return key;
  };

  async setLanguage(lang: SupportedLanguage): Promise<void> {
    if (!bundles[lang]) bundles[lang] = await loaders[lang]();
    this.lang = lang;
    this.#revision += 1;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage blocked - the choice just will not persist */
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }

  /** Load the detected locale. Awaited before the app renders, so no frame
   *  ever paints raw keys. */
  async init(): Promise<void> {
    await this.setLanguage(detectInitialLanguage());
  }
}

export const i18n = new I18n();

/** Shorthand so components read `t("nav.games")` rather than `i18n.t(...)`. */
export const t = i18n.t;
