import { memo } from "react";
import { cn } from "../../../lib/utils";
import { extractAppid } from "../../../lib/data-store";
import type { GameRecord } from "../../../lib/schema";
import { COLS, SELECT_COL_WIDTH } from "./columns";

interface Props {
  game: GameRecord;
  isSelected: boolean;
  translateY: number;
  height: number;
  onSelect: (aid: string) => void;
  onOpen: (g: GameRecord) => void;
}

function TableRowImpl({ game, isSelected, translateY, height, onSelect, onOpen }: Props) {
  const aid = extractAppid(game.link) ?? "";
  return (
    <div
      className={cn(
        "absolute left-0 top-0 flex w-full cursor-pointer items-center border-b border-border/50 hover:bg-accent/40",
        isSelected && "bg-primary/10 hover:bg-primary/15",
      )}
      style={{
        transform: `translateY(${translateY}px)`,
        height,
      }}
      onClick={() => onOpen(game)}
      data-appid={aid}
    >
      <div
        className="flex items-center justify-center"
        style={{ width: SELECT_COL_WIDTH, minWidth: SELECT_COL_WIDTH }}
        onClick={(e) => {
          e.stopPropagation();
          if (aid) onSelect(aid);
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
          {c.render(game)}
        </div>
      ))}
    </div>
  );
}

export const TableRow = memo(TableRowImpl);
