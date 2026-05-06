import { create } from "zustand";

export type SortDir = "asc" | "desc" | null;
export type PageSize = 50 | 100 | 200 | 500 | -1;
export const PAGE_SIZES: PageSize[] = [50, 100, 200, 500, -1];

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
  pageSize: PageSize;
  selected: Set<string>;
  setSearch: (s: string) => void;
  setGenre: (g: string | null) => void;
  setTypeGame: (t: "online" | "offline" | null) => void;
  setPlatform: (p: string | null) => void;
  setSafe: (s: string | null) => void;
  setStatus: (s: "active" | "delisted" | null) => void;
  setHasAntiCheat: (b: boolean | null) => void;
  setSort: (key: string | null, dir: SortDir) => void;
  setPageSize: (size: PageSize) => void;
  toggleSelect: (appid: string) => void;
  selectAll: (appids: string[]) => void;
  clearSelection: () => void;
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
  pageSize: 100 as PageSize,
  selected: new Set<string>(),
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
  setPageSize: (pageSize) => set({ pageSize }),
  toggleSelect: (appid) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(appid)) next.delete(appid);
      else next.add(appid);
      return { selected: next };
    }),
  selectAll: (appids) => set({ selected: new Set(appids) }),
  clearSelection: () => set({ selected: new Set() }),
  reset: () => set({ ...initial, selected: new Set() }),
}));
