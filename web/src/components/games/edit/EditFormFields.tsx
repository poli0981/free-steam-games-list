import { useTranslation } from "react-i18next";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";
import { Label } from "../../ui/label";
import { Button } from "../../ui/button";
import {
  ANTI_CHEAT_ENUM,
  GENRE_ENUM,
  TYPE_GAME_ENUM,
  SAFE_ENUM,
  STATUS_ENUM,
} from "../../../lib/enums";
import type { FormState } from "./types";

interface Props {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}

export function EditFormFields({ form, update }: Props) {
  const { t } = useTranslation();
  const isCustomAC = !(ANTI_CHEAT_ENUM as readonly string[]).includes(form.anti_cheat);
  const lockAC = form.type_game === "offline";
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="genre">{t("edit.genre")}</Label>
          <Input
            id="genre"
            list="genre-list"
            value={form.genre}
            onChange={(e) => update("genre", e.target.value)}
            placeholder={t("edit.genrePlaceholder")}
          />
          <datalist id="genre-list">
            {GENRE_ENUM.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="type_game">{t("edit.type")}</Label>
          <select
            id="type_game"
            value={form.type_game}
            onChange={(e) =>
              update("type_game", e.target.value as FormState["type_game"])
            }
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            {TYPE_GAME_ENUM.map((tg) => (
              <option key={tg || "unknown"} value={tg}>
                {tg || `— ${t("common.unknown")} —`}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="anti_cheat">{t("edit.antiCheat")}</Label>
          <select
            id="anti_cheat"
            value={isCustomAC ? "__custom__" : form.anti_cheat}
            onChange={(e) => {
              if (e.target.value === "__custom__") update("anti_cheat", "");
              else update("anti_cheat", e.target.value);
            }}
            disabled={lockAC}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ANTI_CHEAT_ENUM.map((a) => (
              <option key={a} value={a}>
                {a === "-" ? t("add.noneOption") : a}
              </option>
            ))}
            <option value="__custom__">{t("add.customOption")}</option>
          </select>
          {isCustomAC && (
            <Input
              value={form.anti_cheat}
              onChange={(e) => update("anti_cheat", e.target.value)}
              disabled={lockAC}
              placeholder={t("add.customAcName")}
              className="mt-1"
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label>{t("edit.kernelAc")}</Label>
          <div className="flex gap-1.5">
            {(["unknown", "no", "yes"] as const).map((v) => (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={form.is_kernel_ac === v ? "default" : "outline"}
                onClick={() => update("is_kernel_ac", v)}
                disabled={lockAC}
              >
                {t(`common.${v}`)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="anti_cheat_note">{t("edit.antiCheatNote")}</Label>
        <Textarea
          id="anti_cheat_note"
          value={form.anti_cheat_note}
          onChange={(e) => update("anti_cheat_note", e.target.value)}
          disabled={lockAC}
          placeholder={t("edit.antiCheatNotePlaceholder")}
          rows={2}
        />
        {lockAC && (
          <p className="text-xs text-muted-foreground">
            {t("edit.acLockedOffline")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">{t("edit.notes")}</Label>
        <Textarea
          id="notes"
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder={t("edit.notesPlaceholder")}
          rows={3}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="safe">{t("edit.safe")}</Label>
          <select
            id="safe"
            value={form.safe}
            onChange={(e) => update("safe", e.target.value as FormState["safe"])}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            {SAFE_ENUM.map((s) => (
              <option key={s} value={s}>
                {s === "?" ? t("common.unknown") : s === "y" ? t("common.yes") : t("common.no")}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="status">{t("edit.status")}</Label>
          <select
            id="status"
            value={form.status}
            onChange={(e) =>
              update("status", e.target.value as FormState["status"])
            }
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            {STATUS_ENUM.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}
