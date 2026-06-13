/**
 * Legal consent state: whether the user has accepted the current version of
 * the terms. Persisted to localStorage (no backend, no cookie — same pattern
 * as f2p:theme / f2p:lang / f2p:gpg_*). Incognito tabs get a fresh storage
 * partition, so the gate naturally re-shows there with zero extra code.
 */
import { create } from "zustand";

const KEY = "f2p:legal_consent";

/**
 * Bump this whenever the binding legal documents change materially. A stored
 * acceptance for an older version no longer counts, so everyone is re-prompted.
 */
const TERMS_VERSION = 1;

interface StoredConsent {
  version: number;
  /** ISO timestamp of acceptance — informational only. */
  acceptedAt: string;
}

function loadConsent(): StoredConsent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConsent;
    return typeof parsed?.version === "number" ? parsed : null;
  } catch {
    // Private mode / blocked storage / malformed JSON → treat as not accepted.
    return null;
  }
}

interface ConsentStore {
  /** True only when the stored acceptance matches the current TERMS_VERSION. */
  accepted: boolean;
  accept: () => void;
}

const stored = loadConsent();

export const useConsent = create<ConsentStore>((set) => ({
  accepted: stored?.version === TERMS_VERSION,
  accept: () => {
    const value: StoredConsent = {
      version: TERMS_VERSION,
      acceptedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // If storage is blocked the gate simply re-shows next load — acceptable.
    }
    set({ accepted: true });
  },
}));
