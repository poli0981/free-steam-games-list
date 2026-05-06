import { create } from "zustand";

export type SortDir = "asc" | "desc" | null;

export interface FilterState {
  search: string;
  genre: string | null;
  type_game: "online" | "offline" | null;
  platform: string | null;
  safe: string | null;
  status: "active" | "delisted" | null;
  hasAntiCheat: boolean | null;
  sortKey: string | null;
  sortDir: SortDir;
  setSearch: (s: string) => void;
  setGenre: (g: string | null) => void;
  setTypeGame: (t: "online" | "offline" | null) => void;
  setPlatform: (p: string | null) => void;
  setSafe: (s: string | null) => void;
  setStatus: (s: "active" | "delisted" | null) => void;
  setHasAntiCheat: (b: boolean | null) => void;
  setSort: (key: string | null, dir: SortDir) => void;
  reset: () => void;
}

const initial = {
  search: "",
  genre: null,
  type_game: null,
  platform: null,
  safe: null,
  status: null,
  hasAntiCheat: null,
  sortKey: null,
  sortDir: null as SortDir,
};

export const useFilters = create<FilterState>((set) => ({
  ...initial,
  setSearch: (search) => set({ search }),
  setGenre: (genre) => set({ genre }),
  setTypeGame: (type_game) => set({ type_game }),
  setPlatform: (platform) => set({ platform }),
  setSafe: (safe) => set({ safe }),
  setStatus: (status) => set({ status }),
  setHasAntiCheat: (hasAntiCheat) => set({ hasAntiCheat }),
  setSort: (sortKey, sortDir) => set({ sortKey, sortDir }),
  reset: () => set(initial),
}));
