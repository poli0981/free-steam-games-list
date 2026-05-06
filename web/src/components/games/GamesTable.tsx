import { useMemo, useRef, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Fuse from "fuse.js";
import {
  ArrowUp,
  ArrowDown,
  ExternalLink,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson,
  FileSpreadsheet,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useFilters, PAGE_SIZES, type PageSize } from "../../stores/filters";
import { formatNumber, parseIntSafe, parseReviewPercent } from "../../lib/utils";
import { extractAppid } from "../../lib/data-store";
import type { GameRecord } from "../../lib/schema";
import { cn } from "../../lib/utils";
import { GameDetailDrawer } from "./GameDetailDrawer";
import { BulkActionBar } from "./BulkActionBar";
import { exportCsv, exportJson } from "../../lib/export";
import { recordIssues } from "../../lib/validation";

interface Props {
  records: GameRecord[];
  /** Called when a row's body is clicked; if omitted, falls back to internal drawer. */
  onRowOpen?: (game: GameRecord) => void;
}

interface ColDef {
  key: string;
  label: string;
  width: number;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  render: (g: GameRecord) => React.ReactNode;
  sortValue?: (g: GameRecord) => string | number;
}

const COLS: ColDef[] = [
  {
    key: "thumb",
    label: "",
    width: 56,
    render: (g) =>
      g.header_image ? (
        <img
          loading="lazy"
          src={g.header_image}
          alt=""
          className="h-8 w-16 rounded object-cover"
        />
      ) : (
        <div className="h-8 w-16 rounded bg-muted" />
      ),
  },
  {
    key: "issues",
    label: "",
    width: 28,
    render: (g) => {
      const issues = recordIssues(g);
      if (issues.length === 0) return null;
      return (
        <div
          className="grid h-5 w-5 place-items-center rounded text-amber-400"
          title={issues.map((i) => i.label).join(" · ")}
        >
          <AlertTriangle className="h-3 w-3" />
        </div>
      );
    },
  },
  {
    key: "name",
    label: "Name",
    width: 280,
    sortable: true,
    sortValue: (g) => g.name?.toLowerCase() ?? "",
    render: (g) => <span className="font-medium">{g.name || "—"}</span>,
  },
  {
    key: "genre",
    label: "Genre",
    width: 120,
    sortable: true,
    sortValue: (g) => g.genre ?? "",
    render: (g) =>
      g.genre ? (
        <Badge variant="outline" className="font-normal">
          {g.genre}
        </Badge>
      ) : (
        "—"
      ),
  },
  {
    key: "type_game",
    label: "Type",
    width: 80,
    sortable: true,
    sortValue: (g) => g.type_game ?? "",
    render: (g) =>
      g.type_game ? (
        <Badge
          variant={g.type_game === "online" ? "success" : "secondary"}
          className="font-normal"
        >
          {g.type_game}
        </Badge>
      ) : (
        "—"
      ),
  },
  {
    key: "reviews",
    label: "Reviews",
    width: 110,
    sortable: true,
    align: "right",
    sortValue: (g) => parseReviewPercent(g.reviews) ?? -1,
    render: (g) => {
      const pct = parseReviewPercent(g.reviews);
      if (pct === null) return <span className="text-muted-foreground">—</span>;
      const color =
        pct >= 80 ? "text-emerald-400" : pct >= 70 ? "text-amber-400" : "text-rose-400";
      return <span className={cn("font-mono", color)}>{pct}%</span>;
    },
  },
  {
    key: "current_players",
    label: "Players",
    width: 110,
    sortable: true,
    align: "right",
    sortValue: (g) => parseIntSafe(g.current_players),
    render: (g) => (
      <span className="font-mono">{formatNumber(g.current_players)}</span>
    ),
  },
  {
    key: "anti_cheat",
    label: "AC",
    width: 100,
    sortable: true,
    sortValue: (g) => g.anti_cheat ?? "",
    render: (g) =>
      g.anti_cheat && g.anti_cheat !== "-" ? (
        <Badge
          variant={g.is_kernel_ac ? "destructive" : "warning"}
          className="font-normal"
        >
          {g.anti_cheat}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "platforms",
    label: "Platforms",
    width: 140,
    render: (g) => (
      <span className="text-xs text-muted-foreground">
        {(g.platforms ?? []).join(", ") || "—"}
      </span>
    ),
  },
  {
    key: "release_date",
    label: "Released",
    width: 120,
    sortable: true,
    sortValue: (g) => g.release_date ?? "",
    render: (g) => (
      <span className="text-xs text-muted-foreground">{g.release_date || "—"}</span>
    ),
  },
  {
    key: "status",
    label: "Status",
    width: 90,
    sortable: true,
    sortValue: (g) => g.status ?? "",
    render: (g) => (
      <Badge
        variant={g.status === "active" ? "secondary" : "destructive"}
        className="font-normal"
      >
        {g.status}
      </Badge>
    ),
  },
  {
    key: "link",
    label: "",
    width: 48,
    render: (g) => (
      <a
        href={g.link}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-muted-foreground hover:text-primary"
        title="Open on Steam"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    ),
  },
];

const TOTAL_WIDTH = COLS.reduce((s, c) => s + c.width, 0);

export function GamesTable({ records, onRowOpen }: Props) {
  const search = useFilters((s) => s.search);
  const genre = useFilters((s) => s.genre);
  const typeGame = useFilters((s) => s.type_game);
  const platform = useFilters((s) => s.platform);
  const status = useFilters((s) => s.status);
  const sortKey = useFilters((s) => s.sortKey);
  const sortDir = useFilters((s) => s.sortDir);
  const setSort = useFilters((s) => s.setSort);
  const pageSize = useFilters((s) => s.pageSize);
  const setPageSize = useFilters((s) => s.setPageSize);
  const selected = useFilters((s) => s.selected);
  const toggleSelect = useFilters((s) => s.toggleSelect);
  const [detail, setDetail] = useState<GameRecord | null>(null);
  const [page, setPage] = useState(1);

  // Clear selection on unmount.
  const clearSelection = useFilters((s) => s.clearSelection);
  useEffect(() => clearSelection, [clearSelection]);

  // Reset page when filters or page size change.
  useEffect(() => {
    setPage(1);
  }, [search, genre, typeGame, platform, status, pageSize]);

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
    return out;
  }, [records, search, genre, typeGame, platform, status, fuse]);

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

  // Reset scroll to top whenever the page slice changes.
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

  const SELECT_COL_WIDTH = 36;
  const totalWidth = TOTAL_WIDTH + SELECT_COL_WIDTH;

  return (
    <div className="space-y-3">
      <BulkActionBar visibleAppids={visibleAppids} />

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground">{formatNumber(sorted.length)}</strong>{" "}
            of {formatNumber(records.length)} games
            {selected.size > 0 && (
              <span className="ml-2 text-primary">
                · {formatNumber(selected.size)} selected
              </span>
            )}
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            <ExportMenu records={sorted} />
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
              className="h-7 rounded-md border bg-background px-1.5 text-xs"
              title="Rows per page"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n === -1 ? "All" : `${n}/page`}
                </option>
              ))}
            </select>
            {pageSize !== -1 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  title="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-1 font-mono">
                  {safePage}/{totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  title="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        <div
          ref={containerRef}
          className="relative h-[calc(100vh-300px)] overflow-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
        >
          <div style={{ width: totalWidth, minWidth: "100%" }}>
            {/* Header */}
            <div className="sticky top-0 z-10 flex border-b bg-card/95 backdrop-blur">
              <div
                className="flex h-10 items-center justify-center"
                style={{ width: SELECT_COL_WIDTH, minWidth: SELECT_COL_WIDTH }}
              />
              {COLS.map((c) => {
                const active = sortKey === c.key;
                return (
                  <div
                    key={c.key}
                    className={cn(
                      "flex h-10 items-center px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                      c.align === "right" && "justify-end",
                      c.align === "center" && "justify-center",
                      c.sortable && "cursor-pointer select-none hover:text-foreground",
                    )}
                    style={{ width: c.width, minWidth: c.width }}
                    onClick={() => c.sortable && toggleSort(c.key)}
                  >
                    <span>{c.label}</span>
                    {c.sortable && active && (
                      <span className="ml-1 inline-flex">
                        {sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Virtual rows */}
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
                const isSelected = selected.has(aid);
                return (
                  <div
                    key={vrow.key}
                    className={cn(
                      "absolute left-0 top-0 flex w-full cursor-pointer items-center border-b border-border/50 hover:bg-accent/40",
                      isSelected && "bg-primary/10 hover:bg-primary/15",
                    )}
                    style={{
                      transform: `translateY(${vrow.start}px)`,
                      height: vrow.size,
                    }}
                    onClick={() => (onRowOpen ? onRowOpen(g) : setDetail(g))}
                    data-appid={aid}
                  >
                    <div
                      className="flex items-center justify-center"
                      style={{ width: SELECT_COL_WIDTH, minWidth: SELECT_COL_WIDTH }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (aid) toggleSelect(aid);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="h-3.5 w-3.5 rounded border-input bg-transparent accent-primary"
                      />
                    </div>
                    {COLS.map((c) => (
                      <div
                        key={c.key}
                        className={cn(
                          "flex items-center px-3 py-2 text-sm",
                          c.align === "right" && "justify-end",
                          c.align === "center" && "justify-center",
                        )}
                        style={{ width: c.width, minWidth: c.width }}
                      >
                        {c.render(g)}
                      </div>
                    ))}
                  </div>
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

function ExportMenu({ records }: { records: GameRecord[] }) {
  const [open, setOpen] = useState(false);
  const ts = new Date().toISOString().slice(0, 10);
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen((o) => !o)}
        title={`Export ${records.length} filtered rows`}
      >
        <Download className="mr-1 h-3 w-3" />
        Export
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border bg-card p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                exportCsv(records, `f2p-games-${ts}.csv`);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <FileSpreadsheet className="h-3 w-3" /> CSV
              <span className="ml-auto text-muted-foreground">{records.length} rows</span>
            </button>
            <button
              type="button"
              onClick={() => {
                exportJson(records, `f2p-games-${ts}.json`);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <FileJson className="h-3 w-3" /> JSON
              <span className="ml-auto text-muted-foreground">{records.length} rows</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
