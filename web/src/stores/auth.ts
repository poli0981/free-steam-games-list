import { create } from "zustand";
import {
  loadAuth,
  saveAuth,
  clearAuth,
  fetchUser,
  checkRepoAccess,
  type GitHubUser,
} from "../lib/github-api";

interface AuthStore {
  token: string | null;
  user: GitHubUser | null;
  isAuthenticated: boolean;
  isVerifying: boolean;
  error: string | null;
  permission: string | null;

  hydrate: () => Promise<void>;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
}

const persisted = loadAuth();

export const useAuth = create<AuthStore>((set, get) => ({
  token: persisted.token,
  user: null,
  isAuthenticated: !!persisted.token,
  isVerifying: false,
  error: null,
  permission: null,

  hydrate: async () => {
    const token = get().token;
    if (!token) return;
    set({ isVerifying: true, error: null });
    try {
      const [user, repo] = await Promise.all([
        fetchUser(token),
        checkRepoAccess(token),
      ]);
      if (!repo.ok) throw new Error(repo.error ?? "no repo access");
      set({
        user,
        permission: repo.permission ?? "write",
        isAuthenticated: true,
        isVerifying: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isVerifying: false,
        isAuthenticated: false,
        token: null,
        user: null,
      });
      clearAuth();
    }
  },

  signIn: async (token: string) => {
    set({ isVerifying: true, error: null });
    try {
      const [user, repo] = await Promise.all([
        fetchUser(token),
        checkRepoAccess(token),
      ]);
      if (!repo.ok) throw new Error(repo.error ?? "no repo access");
      saveAuth(token, user.login);
      set({
        token,
        user,
        permission: repo.permission ?? "write",
        isAuthenticated: true,
        isVerifying: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isVerifying: false,
        isAuthenticated: false,
      });
      throw err;
    }
  },

  signOut: () => {
    clearAuth();
    set({ token: null, user: null, isAuthenticated: false, error: null, permission: null });
  },
}));
