import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../ui/button";
import { formatNumber } from "../../../lib/utils";
import { PAGE_SIZES, type PageSize } from "../../../stores/filters";
import { ExportMenu } from "./ExportMenu";
import type { GameRecord } from "../../../lib/schema";

interface Props {
  totalRecords: number;
  filteredCount: number;
  selectedCount: number;
  sorted: GameRecord[];
  pageSize: PageSize;
  setPageSize: (n: PageSize) => void;
  page: number;
  totalPages: number;
  setPage: (updater: (p: number) => number) => void;
}

export function TableToolbar({
  totalRecords,
  filteredCount,
  selectedCount,
  sorted,
  pageSize,
  setPageSize,
  page,
  totalPages,
  setPage,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
      <span>
        <strong className="text-foreground">{formatNumber(filteredCount)}</strong>{" "}
        {t("games.ofTotalGames", { total: formatNumber(totalRecords) })}
        {selectedCount > 0 && (
          <span className="ml-2 text-primary">
            · {formatNumber(selectedCount)} {t("common.selected")}
          </span>
        )}
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        <ExportMenu records={sorted} />
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
          className="h-7 rounded-md border bg-background px-1.5 text-xs"
          title={t("system.rowsPerPageTitle")}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n === -1 ? t("common.all") : t("common.rowsPerPage", { n })}
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
              disabled={page <= 1}
              title={t("system.previousPage")}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-1 font-mono">
              {page}/{totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              title={t("system.nextPage")}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
