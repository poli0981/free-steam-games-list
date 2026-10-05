/**
 * State that outlives a page load: whether the introduction has been seen, the
 * theme and the scrollbar choice. Legal consent lives in consent.svelte.ts.
 *
 * All of it is localStorage-backed with no backend and no cookie — the same
 * pattern as `f2p:lang`. An incognito tab gets a fresh storage partition, so
 * the consent gate re-shows there with no extra code.
 *
 * Every read and write is wrapped: private mode, lockdown settings and the
 * Tauri webview can all refuse storage, and a throw here would take out the
 * whole app shell. readJson/writeJson are exported for consent.svelte.ts and
 * human-check-state.svelte.ts, the only other modules that persist anything
 * this way.
 *
 * THIS FILE IS SHARED WITH THE ADMIN SPA (admin/src/App.svelte imports
 * `theme`), which builds with its own Vite config. It must therefore stay free
 * of `$app/*`, `$lib/*` and any virtual module - the reason consent moved out:
 * it needs `virtual:legal-versions`, and pulling that in here failed the admin
 * build outright.
 */

export function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Blocked storage or malformed JSON. Both mean "no stored value".
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked - the choice just will not persist */
  }
}

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

/* ──────────────────────────── scrollbars ─────────────────────────── */

const SCROLLBARS_KEY = "f2p:scrollbars";

/**
 * "visible" - themed bars everywhere (the default);
 * "panels"  - hidden on .scrollbar-panel (tables, card lists, sidebar,
 *             command palette, wide tables);
 * "all"     - hidden there and on .scrollbar-page, the main content area.
 * Hidden never means unscrollable. styles/theme.css holds the rules; this
 * only sets <html data-scrollbars>. docs/PRIVACY_POLICY.md lists the key.
 */
export type ScrollbarMode = "visible" | "panels" | "all";

export const SCROLLBAR_MODES: readonly ScrollbarMode[] = ["visible", "panels", "all"];

/** A stored value back to a mode; anything unknown is the default. */
export function scrollbarMode(stored: string | null | undefined): ScrollbarMode {
  return stored === "panels" || stored === "all" ? stored : "visible";
}

class ScrollbarPref {
  value = $state<ScrollbarMode>("visible");

  hydrate(): void {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(SCROLLBARS_KEY);
    } catch {
      /* blocked */
    }
    this.value = scrollbarMode(stored);
    this.apply();
  }

  set(next: ScrollbarMode): void {
    this.value = next;
    try {
      // The default is not stored: a reader who never changes it leaves no key.
      if (next === "visible") localStorage.removeItem(SCROLLBARS_KEY);
      else localStorage.setItem(SCROLLBARS_KEY, next);
    } catch {
      /* blocked */
    }
    this.apply();
  }

  apply(): void {
    const root = document.documentElement;
    if (this.value === "visible") delete root.dataset.scrollbars;
    else root.dataset.scrollbars = this.value;
  }
}

export const scrollbars = new ScrollbarPref();
