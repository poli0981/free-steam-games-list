import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "../../../lib/utils";
import { COLS, SELECT_COL_WIDTH } from "./columns";
import type { SortDir } from "../../../stores/filters";

interface Props {
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
}

export function TableHeader({ sortKey, sortDir, toggleSort }: Props) {
  return (
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
  );
}
