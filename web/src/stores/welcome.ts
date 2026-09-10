/**
 * Whether the visitor has seen the welcome page.
 *
 * Deliberately versioned SEPARATELY from f2p:legal_consent. The two answer
 * different questions — "has this person agreed to the terms" versus "has this
 * person been introduced to the site" — and coupling them would mean every
 * legal-document edit re-ran the introduction, which reads as a factory reset.
 * Bump WELCOME_VERSION only when the welcome content itself changes materially.
 */
import { create } from "zustand";

const KEY = "f2p:welcome_seen";

const WELCOME_VERSION = 1;

interface StoredWelcome {
  version: number;
  seenAt: string;
}

function loadWelcome(): StoredWelcome | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWelcome;
    return typeof parsed?.version === "number" ? parsed : null;
  } catch {
    // Blocked storage / malformed JSON → treat as unseen. Worst case the
    // visitor sees the introduction again, which is harmless.
    return null;
  }
}

interface WelcomeStore {
  seen: boolean;
  markSeen: () => void;
  /** Lets Settings offer "show the introduction again". */
  reset: () => void;
}

const stored = loadWelcome();

export const useWelcome = create<WelcomeStore>((set) => ({
  seen: stored?.version === WELCOME_VERSION,
  markSeen: () => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ version: WELCOME_VERSION, seenAt: new Date().toISOString() }),
      );
    } catch {
      /* ignore — see loadWelcome */
    }
    set({ seen: true });
  },
  reset: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({ seen: false });
  },
}));
