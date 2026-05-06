/**
 * GPG state: encrypted armored key in localStorage; decrypted key in memory only.
 * Decrypted key is wiped on tab close (no persistence) and on lock().
 */
import { create } from "zustand";
import {
  parsePrivateKey,
  unlockPrivateKey,
  type ParsedKey,
  type UnlockedKey,
} from "../lib/gpg";

const KEY_ARMORED = "f2p:gpg_armored";
const KEY_AUTOLOCK_MIN = "f2p:gpg_autolock_min";
const KEY_PREFERRED_UID = "f2p:gpg_preferred_uid";

interface GpgStore {
  /** Parsed metadata of the saved key (no secret material). */
  parsed: ParsedKey | null;
  /** In-memory decrypted key — cleared on lock or page close. */
  unlocked: UnlockedKey | null;
  isVerifying: boolean;
  error: string | null;
  /** Index into parsed.userIds (or null = use index 0). Persisted. */
  preferredUidIndex: number;
  /** Auto-lock idle minutes (0 = never). Persisted. */
  autolockMinutes: number;

  hydrate: () => Promise<void>;
  saveKey: (armored: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
  clearKey: () => void;
  setPreferredUidIndex: (idx: number) => void;
  setAutolockMinutes: (mins: number) => void;
}

const armoredFromStorage = localStorage.getItem(KEY_ARMORED);

function loadPreferredUid(): number {
  const raw = localStorage.getItem(KEY_PREFERRED_UID);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

function loadAutolock(): number {
  const raw = localStorage.getItem(KEY_AUTOLOCK_MIN);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

export const useGpg = create<GpgStore>((set, get) => ({
  parsed: null,
  unlocked: null,
  isVerifying: false,
  error: null,
  preferredUidIndex: loadPreferredUid(),
  autolockMinutes: loadAutolock(),

  hydrate: async () => {
    if (!armoredFromStorage || get().parsed) return;
    set({ isVerifying: true, error: null });
    try {
      const parsed = await parsePrivateKey(armoredFromStorage);
      set({ parsed, isVerifying: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isVerifying: false,
      });
    }
  },

  saveKey: async (armored: string) => {
    set({ isVerifying: true, error: null });
    try {
      const parsed = await parsePrivateKey(armored);
      localStorage.setItem(KEY_ARMORED, armored);
      // Reset preferred UID — different key, different IDs.
      localStorage.removeItem(KEY_PREFERRED_UID);
      set({
        parsed,
        unlocked: null,
        isVerifying: false,
        preferredUidIndex: 0,
      });
    } catch (err) {
      set({
        error:
          err instanceof Error
            ? `Failed to parse key: ${err.message}`
            : String(err),
        isVerifying: false,
      });
      throw err;
    }
  },

  unlock: async (passphrase: string) => {
    const armored = localStorage.getItem(KEY_ARMORED);
    if (!armored) throw new Error("No saved key. Upload one first.");
    set({ isVerifying: true, error: null });
    try {
      const unlocked = await unlockPrivateKey(armored, passphrase);
      set({ parsed: unlocked.parsed, unlocked, isVerifying: false });
    } catch (err) {
      set({
        error:
          err instanceof Error && err.message.toLowerCase().includes("password")
            ? "Wrong passphrase"
            : err instanceof Error
              ? err.message
              : String(err),
        isVerifying: false,
      });
      throw err;
    }
  },

  lock: () => {
    set({ unlocked: null });
  },

  clearKey: () => {
    localStorage.removeItem(KEY_ARMORED);
    localStorage.removeItem(KEY_PREFERRED_UID);
    set({ parsed: null, unlocked: null, error: null, preferredUidIndex: 0 });
  },

  setPreferredUidIndex: (idx: number) => {
    localStorage.setItem(KEY_PREFERRED_UID, String(idx));
    set({ preferredUidIndex: idx });
  },

  setAutolockMinutes: (mins: number) => {
    if (mins <= 0) localStorage.removeItem(KEY_AUTOLOCK_MIN);
    else localStorage.setItem(KEY_AUTOLOCK_MIN, String(mins));
    set({ autolockMinutes: mins });
  },
}));
