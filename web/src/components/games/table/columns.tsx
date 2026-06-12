import { ExternalLink, AlertTriangle } from "lucide-react";
import { Badge } from "../../ui/badge";
import i18nDefault from "../../../i18n";
import {
  formatNumber,
  parseIntSafe,
  parseReleaseDate,
  parseReviewPercent,
} from "../../../lib/utils";
import { headerToCapsule } from "../../../lib/image";
import { cn } from "../../../lib/utils";
import { recordIssues } from "../../../lib/validation";
import type { GameRecord } from "../../../lib/schema";

export interface ColDef {
  key: string;
  label: string;
  width: number;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  render: (g: GameRecord) => React.ReactNode;
  sortValue?: (g: GameRecord) => string | number;
}

export const COLS: ColDef[] = [
  {
    key: "thumb",
    label: "",
    width: 56,
    render: (g) =>
      g.header_image ? (
        <img
          loading="lazy"
          decoding="async"
          src={headerToCapsule(g.header_image)}
          alt=""
          width={92}
          height={43}
          className="h-8 w-16 rounded object-cover"
          onError={(e) => {
            const el = e.currentTarget;
            if (el.src !== g.header_image) el.src = g.header_image;
          }}
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
    render: (g) => (
      <span className="font-medium">
        {g.is_dead && <span title="Dead game (no players)" className="mr-1">💀</span>}
        {g.name || "—"}
      </span>
    ),
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
    // Parse Steam-style date strings ("22 Aug, 2012") to timestamps —
    // string-compare scrambles years alphabetically otherwise.
    sortValue: (g) => parseReleaseDate(g.release_date),
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
        title={i18nDefault.t("edit.openOnSteam")}
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    ),
  },
];

export const TOTAL_WIDTH = COLS.reduce((s, c) => s + c.width, 0);
export const SELECT_COL_WIDTH = 36;
