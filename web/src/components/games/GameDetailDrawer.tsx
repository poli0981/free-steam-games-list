import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { Button } from "../ui/button";
import {
  ExternalLink,
  Calendar,
  Star,
  Users,
  Shield,
  Globe,
  Tag,
  Pencil,
} from "lucide-react";
import {
  formatNumber,
  parseReviewPercent,
  reviewLabel,
  formatRelativeDate,
} from "../../lib/utils";
import { extractAppid } from "../../lib/data-store";
import type { GameRecord } from "../../lib/schema";
import { EditGameDrawer } from "./EditGameDrawer";
import { useAuth } from "../../stores/auth";

interface Props {
  game: GameRecord | null;
  onClose: () => void;
}

function Field({
  label,
  children,
  icon: Icon,
}: {
  label: string;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function GameDetailDrawer({ game, onClose }: Props) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);

  return (
    <Dialog open={!!game} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {game && (
          <div className="space-y-6">
            <DialogHeader>
              {game.header_image && (
                <img
                  src={game.header_image}
                  alt=""
                  className="h-44 w-full rounded-md object-cover"
                />
              )}
              <div className="flex items-start justify-between gap-3">
                <DialogTitle className="text-xl">{game.name || "—"}</DialogTitle>
                {auth.isAuthenticated && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="mr-1 h-3 w-3" /> Edit
                  </Button>
                )}
              </div>
              <DialogDescription>
                <a
                  href={game.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  appid {extractAppid(game.link)} · open on Steam{" "}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </DialogDescription>
            </DialogHeader>

            {game.description && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {game.description}
              </p>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Genre" icon={Tag}>
                {game.genre || "—"}
              </Field>
              <Field label="Type">
                {game.type_game ? (
                  <Badge variant={game.type_game === "online" ? "success" : "secondary"}>
                    {game.type_game}
                  </Badge>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Developer">
                {(game.developer ?? []).join(", ") || "—"}
              </Field>
              <Field label="Publisher">
                {(game.publisher ?? []).join(", ") || "—"}
              </Field>
              <Field label="Released" icon={Calendar}>
                {game.release_date || "—"}
              </Field>
              <Field label="Platforms" icon={Globe}>
                {(game.platforms ?? []).join(" · ") || "—"}
              </Field>
              <Field label="Reviews" icon={Star}>
                {parseReviewPercent(game.reviews) !== null ? (
                  <span>
                    <span className="font-mono">
                      {parseReviewPercent(game.reviews)}%
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      {reviewLabel(game.reviews)}
                    </span>
                  </span>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Players" icon={Users}>
                {formatNumber(game.current_players)}{" "}
                <span className="text-muted-foreground">
                  (peak {formatNumber(game.peak_today)})
                </span>
              </Field>
              <Field label="Anti-cheat" icon={Shield}>
                {game.anti_cheat && game.anti_cheat !== "-" ? (
                  <span className="space-x-2">
                    <Badge variant={game.is_kernel_ac ? "destructive" : "warning"}>
                      {game.anti_cheat}
                    </Badge>
                    {game.is_kernel_ac && (
                      <span className="text-xs text-rose-400">kernel-level</span>
                    )}
                  </span>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Metacritic">{game.metacritic || "—"}</Field>
              <Field label="DRM">{game.drm_notes || "—"}</Field>
              <Field label="Has paid DLC">{game.has_paid_dlc ? "Yes" : "No"}</Field>
              <Field label="Status">{game.status}</Field>
              <Field label="Last updated">{formatRelativeDate(game.last_updated)}</Field>
            </div>

            {game.tags?.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Tags
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {game.tags.map((t) => (
                      <Badge key={t} variant="outline" className="font-normal">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {game.languages?.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Languages ({game.languages.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    {game.languages.slice(0, 30).map((l) => (
                      <span key={l} className="rounded bg-muted px-1.5 py-0.5">
                        {l}
                      </span>
                    ))}
                    {game.languages.length > 30 && (
                      <span className="text-muted-foreground">
                        +{game.languages.length - 30}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            {game.notes && (
              <>
                <Separator />
                <Field label="Notes">{game.notes}</Field>
              </>
            )}
          </div>
        )}
      </DialogContent>
      {editing && (
        <EditGameDrawer game={game} onClose={() => setEditing(false)} />
      )}
    </Dialog>
  );
}
