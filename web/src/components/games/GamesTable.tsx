import { useMemo, useRef, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Fuse from "fuse.js";
import { useFilters } from "../../stores/filters";
import { extractAppid } from "../../lib/data-store";
import type { GameRecord } from "../../lib/schema";
import { GameDetailDrawer } from "./GameDetailDrawer";
import { BulkActionBar } from "./BulkActionBar";
import { COLS, TOTAL_WIDTH, SELECT_COL_WIDTH } from "./table/columns";
import { TableHeader } from "./table/TableHeader";
import { TableRow } from "./table/TableRow";
import { TableToolbar } from "./table/TableToolbar";

interface Props {
  records: GameRecord[];
  /** Called when a row's body is clicked; if omitted, falls back to internal drawer. */
  onRowOpen?: (game: GameRecord) => void;
}

export function GamesTable({ records, onRowOpen }: Props) {
  const search = useFilters((s) => s.search);
  const genre = useFilters((s) => s.genre);
  const typeGame = useFilters((s) => s.type_game);
  const platform = useFilters((s) => s.platform);
  const status = useFilters((s) => s.status);
  const hideDead = useFilters((s) => s.hideDead);
  const sortKey = useFilters((s) => s.sortKey);
  const sortDir = useFilters((s) => s.sortDir);
  const setSort = useFilters((s) => s.setSort);
  const pageSize = useFilters((s) => s.pageSize);
  const setPageSize = useFilters((s) => s.setPageSize);
  const selected = useFilters((s) => s.selected);
  const toggleSelect = useFilters((s) => s.toggleSelect);
  const [detail, setDetail] = useState<GameRecord | null>(null);
  const [page, setPage] = useState(1);

  const clearSelection = useFilters((s) => s.clearSelection);
  useEffect(() => clearSelection, [clearSelection]);

  useEffect(() => {
    setPage(1);
  }, [search, genre, typeGame, platform, status, hideDead, pageSize]);

  const fuse = useMemo(
    () =>
      new Fuse(records, {
        keys: ["name", "description", "tags", "developer", "publisher"],
        threshold: 0.32,
        ignoreLocation: true,
      }),
    [records],
  );

  const filtered = useMemo(() => {
    let out = records;
    if (search.trim()) {
      out = fuse.search(search.trim()).map((r) => r.item);
    }
    if (genre) out = out.filter((g) => g.genre === genre);
    if (typeGame) out = out.filter((g) => g.type_game === typeGame);
    if (platform)
      out = out.filter((g) => (g.platforms ?? []).includes(platform));
    if (status) out = out.filter((g) => g.status === status);
    if (hideDead) out = out.filter((g) => !g.is_dead);
    return out;
  }, [records, search, genre, typeGame, platform, status, hideDead, fuse]);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    const col = COLS.find((c) => c.key === sortKey);
    if (!col?.sortValue) return filtered;
    const sv = col.sortValue;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages =
    pageSize === -1 ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paged = useMemo(() => {
    if (pageSize === -1) return sorted;
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, pageSize, safePage]);

  const containerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: paged.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [safePage, pageSize, sortKey, sortDir]);

  const visibleAppids = useMemo(() => {
    const out: string[] = [];
    for (const g of paged) {
      const aid = extractAppid(g.link);
      if (aid) out.push(aid);
    }
    return out;
  }, [paged]);

  function toggleSort(key: string) {
    if (sortKey !== key) return setSort(key, "desc");
    if (sortDir === "desc") return setSort(key, "asc");
    return setSort(null, null);
  }

  const totalWidth = TOTAL_WIDTH + SELECT_COL_WIDTH;
  const handleOpen = onRowOpen ?? setDetail;

  return (
    <div className="space-y-3">
      <BulkActionBar visibleAppids={visibleAppids} />

      <div className="rounded-lg border bg-card">
        <TableToolbar
          totalRecords={records.length}
          filteredCount={sorted.length}
          selectedCount={selected.size}
          sorted={sorted}
          pageSize={pageSize}
          setPageSize={setPageSize}
          page={safePage}
          totalPages={totalPages}
          setPage={setPage}
        />

        <div
          ref={containerRef}
          className="relative h-[calc(100vh-300px)] overflow-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
        >
          <div style={{ width: totalWidth, minWidth: "100%" }}>
            <TableHeader sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} />

            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((vrow) => {
                const g = paged[vrow.index];
                const aid = extractAppid(g.link) ?? "";
                return (
                  <TableRow
                    key={vrow.key}
                    game={g}
                    isSelected={selected.has(aid)}
                    translateY={vrow.start}
                    height={vrow.size}
                    onSelect={toggleSelect}
                    onOpen={handleOpen}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {!onRowOpen && (
          <GameDetailDrawer game={detail} onClose={() => setDetail(null)} />
        )}
      </div>
    </div>
  );
}
