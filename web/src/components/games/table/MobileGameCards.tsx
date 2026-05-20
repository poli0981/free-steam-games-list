import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { ExternalLink, AlertTriangle } from "lucide-react";
import { Badge } from "../../ui/badge";
import { cn, formatNumber, parseReviewPercent } from "../../../lib/utils";
import { extractAppid } from "../../../lib/data-store";
import { headerToCapsule } from "../../../lib/image";
import { recordIssues } from "../../../lib/validation";
import type { GameRecord } from "../../../lib/schema";

interface Props {
  records: GameRecord[];
  selected: Set<string>;
  onSelect: (aid: string) => void;
  onOpen: (g: GameRecord) => void;
}

// Mobile-only card list. Mirrors GamesTable filtering/paging — caller passes
// the already-paged `records`. Virtualised for parity with the desktop table
// (1.2k+ records would otherwise stall scroll on touch devices).
export function MobileGameCards({ records, selected, onSelect, onOpen }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 96, // card height incl. padding + border
    overscan: 8,
  });

  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100vh-260px)] overflow-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((vrow) => {
          const g = records[vrow.index];
          const aid = extractAppid(g.link) ?? "";
          const isSelected = selected.has(aid);
          const issues = recordIssues(g);
          const pct = parseReviewPercent(g.reviews);
          const reviewColor =
            pct === null
              ? "text-muted-foreground"
              : pct >= 80
                ? "text-emerald-400"
                : pct >= 70
                  ? "text-amber-400"
                  : "text-rose-400";
          return (
            <div
              key={vrow.key}
              className={cn(
                "absolute left-0 top-0 flex w-full cursor-pointer items-start gap-3 border-b border-border/50 px-3 py-2 hover:bg-accent/40",
                isSelected && "bg-primary/10 hover:bg-primary/15",
              )}
              style={{
                transform: `translateY(${vrow.start}px)`,
                height: vrow.size,
              }}
              onClick={() => onOpen(g)}
              data-appid={aid}
            >
              {/* Selection checkbox */}
              <div
                className="pt-1"
                onClick={(e) => {
                  e.stopPropagation();
                  if (aid) onSelect(aid);
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {}}
                  className="h-4 w-4 rounded border-input bg-transparent accent-primary"
                />
              </div>

              {/* Thumb */}
              <div className="shrink-0">
                {g.header_image ? (
                  <img
                    loading="lazy"
                    src={headerToCapsule(g.header_image)}
                    alt=""
                    width={80}
                    height={37}
                    className="h-10 w-20 rounded object-cover"
                  />
                ) : (
                  <div className="h-10 w-20 rounded bg-muted" />
                )}
              </div>

              {/* Main content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1 truncate text-sm font-medium">
                    {g.is_dead && <span title="Dead game">💀</span>}
                    {issues.length > 0 && (
                      <AlertTriangle
                        className="h-3 w-3 shrink-0 text-amber-400"
                        aria-label={issues.map((i) => i.label).join(" · ")}
                      />
                    )}
                    <span className="truncate">{g.name || "—"}</span>
                  </div>
                  <a
                    href={g.link}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 text-muted-foreground hover:text-primary"
                    aria-label={t("edit.openOnSteam")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  {g.genre && (
                    <Badge variant="outline" className="font-normal">
                      {g.genre}
                    </Badge>
                  )}
                  {g.type_game && (
                    <Badge
                      variant={g.type_game === "online" ? "success" : "secondary"}
                      className="font-normal"
                    >
                      {g.type_game}
                    </Badge>
                  )}
                  {g.anti_cheat && g.anti_cheat !== "-" && (
                    <Badge
                      variant={g.is_kernel_ac ? "destructive" : "warning"}
                      className="font-normal"
                    >
                      {g.anti_cheat}
                    </Badge>
                  )}
                  {g.status !== "active" && (
                    <Badge variant="destructive" className="font-normal">
                      {g.status}
                    </Badge>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className={cn("font-mono", reviewColor)}>
                    {pct === null ? "—" : `${pct}%`}
                  </span>
                  <span className="font-mono">
                    {formatNumber(g.current_players)} {t("antiCheatList.players").toLowerCase()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
