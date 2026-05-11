import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  Monitor,
} from "lucide-react";
import {
  formatNumber,
  parseReviewPercent,
  reviewLabel,
  formatRelativeDate,
} from "../../lib/utils";
import { extractAppid } from "../../lib/data-store";
import { steamProtocolUrl, steamWebUrl } from "../../lib/steam-link";
import { webpProxyUrl } from "../../lib/image";
import type { GameRecord } from "../../lib/schema";
import { EditGameDrawer } from "./EditGameDrawer";
import { useIsOwner } from "../../hooks/useIsOwner";

interface Props {
  game: GameRecord | null;
  onClose: () => void;
  /** Set when the deep-link URL pointed at an appid that doesn't exist. */
  missing?: string;
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

export function GameDetailDrawer({ game, onClose, missing }: Props) {
  const { t } = useTranslation();
  const isOwner = useIsOwner();
  const [editing, setEditing] = useState(false);

  return (
    <Dialog open={!!game || !!missing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {!game && missing && (
          <div className="space-y-3">
            <DialogHeader>
              <DialogTitle>{t("dialogs.gameNotFound")}</DialogTitle>
              <DialogDescription>
                {t("dialogs.gameNotFoundBody", { appid: missing })}{" "}
                <a
                  href={`https://store.steampowered.com/app/${missing}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {t("detail.viewSteamPage")}
                </a>{" "}
                ·{" "}
                <a href="#/health" className="text-primary hover:underline">
                  {t("detail.viewHealth")}
                </a>
              </DialogDescription>
            </DialogHeader>
          </div>
        )}
        {game && (
          <div className="space-y-6">
            <DialogHeader>
              {game.header_image && (
                <picture>
                  <source
                    srcSet={webpProxyUrl(game.header_image, 460)}
                    type="image/webp"
                  />
                  <img
                    loading="lazy"
                    src={game.header_image}
                    alt=""
                    width={460}
                    height={215}
                    className="h-44 w-full rounded-md object-cover"
                  />
                </picture>
              )}
              <div className="flex items-start justify-between gap-3">
                <DialogTitle className="text-xl">{game.name || "—"}</DialogTitle>
                {isOwner && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="mr-1 h-3 w-3" /> {t("common.edit")}
                  </Button>
                )}
              </div>
              <DialogDescription asChild>
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">
                    {t("detail.openOnSteam", { appid: extractAppid(game.link) })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const appid = extractAppid(game.link);
                      const protocol = appid ? steamProtocolUrl(appid) : game.link;
                      const web = appid ? steamWebUrl(appid) : game.link;
                      return (
                        <>
                          <Button asChild size="sm" variant="default">
                            <a
                              href={protocol}
                              title={t("detail.openOnSteamDesktopHint")}
                            >
                              <Monitor className="mr-1 h-3 w-3" />
                              {t("detail.openOnSteamDesktop")}
                            </a>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <a href={web} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="mr-1 h-3 w-3" />
                              {t("detail.openOnSteamWeb")}
                            </a>
                          </Button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </DialogDescription>
            </DialogHeader>

            {game.description && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {game.description}
              </p>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label={t("detail.labelGenre")} icon={Tag}>
                {game.genre || "—"}
              </Field>
              <Field label={t("detail.labelType")}>
                {game.type_game ? (
                  <Badge variant={game.type_game === "online" ? "success" : "secondary"}>
                    {game.type_game}
                  </Badge>
                ) : (
                  "—"
                )}
              </Field>
              <Field label={t("detail.labelDeveloper")}>
                {(game.developer ?? []).join(", ") || "—"}
              </Field>
              <Field label={t("detail.labelPublisher")}>
                {(game.publisher ?? []).join(", ") || "—"}
              </Field>
              <Field label={t("detail.labelReleased")} icon={Calendar}>
                {game.release_date || "—"}
              </Field>
              <Field label={t("detail.labelPlatforms")} icon={Globe}>
                {(game.platforms ?? []).join(" · ") || "—"}
              </Field>
              <Field label={t("detail.labelReviews")} icon={Star}>
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
              <Field label={t("detail.labelPlayers")} icon={Users}>
                {formatNumber(game.current_players)}{" "}
                <span className="text-muted-foreground">
                  {t("detail.playersPeak", { peak: formatNumber(game.peak_today) })}
                </span>
              </Field>
              <Field label={t("detail.labelAntiCheat")} icon={Shield}>
                {game.anti_cheat && game.anti_cheat !== "-" ? (
                  <span className="space-x-2">
                    <Badge variant={game.is_kernel_ac ? "destructive" : "warning"}>
                      {game.anti_cheat}
                    </Badge>
                    {game.is_kernel_ac && (
                      <span className="text-xs text-rose-400">{t("detail.kernelLevel")}</span>
                    )}
                  </span>
                ) : (
                  "—"
                )}
              </Field>
              <Field label={t("detail.labelMetacritic")}>{game.metacritic || "—"}</Field>
              <Field label={t("detail.labelDrm")}>{game.drm_notes || "—"}</Field>
              <Field label={t("detail.labelHasPaidDlc")}>
                {game.has_paid_dlc ? t("common.yes") : t("common.no")}
              </Field>
              <Field label={t("detail.labelStatus")}>{game.status}</Field>
              <Field label={t("detail.labelLastUpdated")}>
                {formatRelativeDate(game.last_updated)}
              </Field>
            </div>

            {game.tags?.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("detail.labelTags")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {game.tags.map((tg) => (
                      <Badge key={tg} variant="outline" className="font-normal">
                        {tg}
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
                    {t("detail.labelLanguages", { count: game.languages.length })}
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
                <Field label={t("detail.labelNotes")}>{game.notes}</Field>
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
