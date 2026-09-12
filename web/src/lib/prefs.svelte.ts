/**
 * The three pieces of state that outlive a page load: legal consent, whether
 * the introduction has been seen, and the theme.
 *
 * All three are localStorage-backed with no backend and no cookie — the same
 * pattern as `f2p:lang`. An incognito tab gets a fresh storage partition, so
 * the consent gate re-shows there with no extra code.
 *
 * Every read and write is wrapped: private mode, lockdown settings and the
 * Tauri webview can all refuse storage, and a throw here would take out the
 * whole app shell.
 */

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Blocked storage or malformed JSON. Both mean "no stored value".
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked - the choice just will not persist */
  }
}

/* ───────────────────────────── consent ───────────────────────────── */

const CONSENT_KEY = "f2p:legal_consent";

/**
 * Bump whenever the binding legal documents change materially: a stored
 * acceptance for an older version stops counting and everyone is re-prompted.
 *
 * 3 (Sept 2026): the licence split, plus a Privacy Policy that now discloses
 * edge logging where the previous one claimed there was no server at all.
 */
export const TERMS_VERSION = 3;

interface StoredConsent {
  version: number;
  /** ISO timestamp of acceptance - informational only. */
  acceptedAt: string;
}

class Consent {
  accepted = $state(false);

  /** Read from storage. Called once the app is mounted, never during
   *  prerender, where there is no localStorage. */
  hydrate(): void {
    this.accepted = readJson<StoredConsent>(CONSENT_KEY)?.version === TERMS_VERSION;
  }

  accept(): void {
    writeJson(CONSENT_KEY, {
      version: TERMS_VERSION,
      acceptedAt: new Date().toISOString(),
    } satisfies StoredConsent);
    this.accepted = true;
  }
}

export const consent = new Consent();

/* ───────────────────────────── welcome ───────────────────────────── */

const WELCOME_KEY = "f2p:welcome_seen";

/**
 * Versioned SEPARATELY from consent on purpose. The two answer different
 * questions — "has this person agreed to the terms" versus "has this person
 * been introduced to the site" — and coupling them would mean every legal edit
 * re-ran the introduction, which reads as a factory reset. Bump only when the
 * welcome content itself changes materially.
 */
export const WELCOME_VERSION = 1;

class Welcome {
  seen = $state(false);

  hydrate(): void {
    this.seen = readJson<{ version: number }>(WELCOME_KEY)?.version === WELCOME_VERSION;
  }

  markSeen(): void {
    writeJson(WELCOME_KEY, { version: WELCOME_VERSION, seenAt: new Date().toISOString() });
    this.seen = true;
  }

  /** Lets Settings offer "show the introduction again". */
  reset(): void {
    try {
      localStorage.removeItem(WELCOME_KEY);
    } catch {
      /* ignore */
    }
    this.seen = false;
  }
}

export const welcome = new Welcome();

/* ────────────────────────────── theme ────────────────────────────── */

const THEME_KEY = "f2p:theme";
export type Theme = "light" | "dark" | "system";

class ThemePref {
  value = $state<Theme>("dark");
  /** What "system" currently resolves to. Tracked so the UI can show it. */
  resolved = $state<"light" | "dark">("dark");

  #media: MediaQueryList | null = null;

  hydrate(): void {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      /* blocked */
    }
    this.value =
      stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";

    // The React Topbar read matchMedia ONCE and never listened, so "system"
    // never actually reacted to the OS switching at dusk. This listens.
    this.#media ??= window.matchMedia("(prefers-color-scheme: dark)");
    this.#media.addEventListener("change", () => {
      if (this.value === "system") this.apply();
    });

    this.apply();
  }

  set(next: Theme): void {
    this.value = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* blocked */
    }
    this.apply();
  }

  apply(): void {
    const prefersDark = this.#media?.matches ?? true;
    const dark = this.value === "dark" || (this.value === "system" && prefersDark);
    this.resolved = dark ? "dark" : "light";
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    // Keeps the browser UI (address bar, Android status bar) in step.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#131110" : "#fbfaf7");
  }
}

export const theme = new ThemePref();
