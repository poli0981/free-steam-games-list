import { useTranslation } from "react-i18next";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Label } from "../../ui/label";
import { Badge } from "../../ui/badge";
import { Separator } from "../../ui/separator";
import { DiffViewer } from "../DiffViewer";
import { JsonDiff } from "./EditJsonView";
import type { EditPatch } from "../../../lib/edits";
import type { GameRecord } from "../../../lib/schema";
import type { View } from "./types";

interface Props {
  view: View;
  game: GameRecord;
  patch: EditPatch;
  parsedJson: GameRecord | null;
  willSign: boolean;
}

export function EditChangePreview({ view, game, patch, parsedJson, willSign }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <Separator />
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t("edit.diffPreview")}</Label>
          <div className="flex items-center gap-1.5">
            {view === "form" && (
              <Badge variant="secondary">
                {t("edit.fields", { count: Object.keys(patch).length })}
              </Badge>
            )}
            {willSign ? (
              <Badge variant="success">
                <ShieldCheck className="mr-1 h-3 w-3" /> {t("games.willSign")}
              </Badge>
            ) : (
              <Badge variant="warning">
                <ShieldAlert className="mr-1 h-3 w-3" /> {t("games.unsigned")}
              </Badge>
            )}
          </div>
        </div>
        {view === "form" ? (
          <DiffViewer before={game} patch={patch} />
        ) : (
          <JsonDiff before={game} after={parsedJson} />
        )}
        {!willSign && (
          <p className="text-xs text-muted-foreground">
            {t("edit.unsignedHint")}
          </p>
        )}
      </div>
    </>
  );
}
