import { memo } from "react";
import { cn } from "../../../lib/utils";
import { extractAppid } from "../../../lib/data-store";
import type { GameRecord } from "../../../lib/schema";
import { COLS } from "./columns";

interface Props {
  game: GameRecord;
  translateY: number;
  height: number;
  onOpen: (g: GameRecord) => void;
}

function TableRowImpl({ game, translateY, height, onOpen }: Props) {
  const aid = extractAppid(game.link) ?? "";
  return (
    <div
      className={cn(
        "absolute left-0 top-0 flex w-full cursor-pointer items-center border-b border-border/50 hover:bg-accent/40",
      )}
      style={{
        transform: `translateY(${translateY}px)`,
        height,
      }}
      onClick={() => onOpen(game)}
      data-appid={aid}
    >
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
