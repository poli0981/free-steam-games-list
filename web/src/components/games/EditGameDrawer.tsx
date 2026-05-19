import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, AlertCircle, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { useAuth } from "../../stores/auth";
import { useGames } from "../../hooks/useGames";
import { useCommitContext } from "../../hooks/useCommitContext";
import { extractAppid } from "../../lib/data-store";
import {
  updateGame,
  replaceGame,
  RefAdvancedError,
} from "../../lib/edits";
import { optimisticEdit, optimisticReplace } from "../../lib/optimistic";
import { pollCommitVerification } from "../../lib/verify-commit";
import { openExternal } from "../../lib/external-open";
import type { GameRecord } from "../../lib/schema";
import { ViewToggle } from "./edit/ViewToggle";
import { EditFormFields } from "./edit/EditFormFields";
import { EditJsonView } from "./edit/EditJsonView";
import { EditChangePreview } from "./edit/EditChangePreview";
import { gameToForm, formToPatch } from "./edit/form-utils";
import type { FormState, View } from "./edit/types";

interface Props {
  game: GameRecord | null;
  onClose: () => void;
}

export function EditGameDrawer({ game, onClose }: Props) {
  const { t } = useTranslation();
  const auth = useAuth();
  const ctx = useCommitContext();
  const games = useGames();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("form");
  const [form, setForm] = useState<FormState | null>(null);
  const [json, setJson] = useState<string>("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!game) {
      setForm(null);
      setJson("");
      return;
    }
    setForm(gameToForm(game));
    setJson(JSON.stringify(game, null, 2));
    setShowConfirm(false);
    setSaving(false);
    setJsonError(null);
    setView("form");
  }, [game]);

  const flatIndex = useMemo(() => {
    if (!game || !games.data) return -1;
    const aid = extractAppid(game.link);
    if (!aid) return -1;
    return games.data.appidIndex.get(aid) ?? -1;
  }, [game, games.data]);

  const patch = useMemo(() => {
    if (!game || !form) return {};
    return formToPatch(game, form);
  }, [game, form]);

  const parsedJson = useMemo<GameRecord | null>(() => {
    if (view !== "json") return null;
    try {
      const obj = JSON.parse(json);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
      return obj as GameRecord;
    } catch {
      return null;
    }
  }, [view, json]);

  const jsonChanged = useMemo(() => {
    if (!game || !parsedJson) return false;
    return JSON.stringify(parsedJson) !== JSON.stringify(game);
  }, [game, parsedJson]);

  const hasChanges =
    view === "form" ? Object.keys(patch).length > 0 : jsonChanged && !jsonError;

  if (!game || !form) return null;

  if (!auth.isAuthenticated) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("edit.signInRequired")}</DialogTitle>
            <DialogDescription>{t("edit.signInDescription")}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  function validateJson(text: string): GameRecord | null {
    setJsonError(null);
    let obj: unknown;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
      return null;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      setJsonError("Top-level value must be an object");
      return null;
    }
    const r = obj as Record<string, unknown>;
    const aidEdited = extractAppid(typeof r.link === "string" ? r.link : "");
    const aidOriginal = extractAppid(game!.link);
    if (aidEdited !== aidOriginal) {
      setJsonError(
        `Link's appid (${aidEdited ?? "?"}) must match the original (${aidOriginal}).`,
      );
      return null;
    }
    return obj as GameRecord;
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => {
      if (!f) return f;
      const next = { ...f, [key]: value };
      if (key === "type_game" && value === "offline") {
        next.anti_cheat = "";
        next.anti_cheat_note = "";
        next.is_kernel_ac = "unknown";
      }
      return next;
    });
  }

  async function save() {
    if (!auth.token || !ctx || !game || !games.data || flatIndex === -1) return;
    setSaving(true);
    const toastId = `commit-${Date.now()}`;
    try {
      let replacementRecord: GameRecord | null = null;
      if (view === "json") {
        replacementRecord = validateJson(json);
        if (!replacementRecord) throw new Error(jsonError ?? "Invalid JSON");
      }

      const result =
        view === "form"
          ? await updateGame({
              record: game,
              patch,
              flatIndex,
              index: games.data.index,
              author: ctx.author,
              signer: ctx.signer,
              token: auth.token,
              triggerMarkdownRebuild: true,
            })
          : await replaceGame({
              original: game,
              replacement: replacementRecord!,
              flatIndex,
              index: games.data.index,
              author: ctx.author,
              signer: ctx.signer,
              token: auth.token,
              triggerMarkdownRebuild: true,
            });

      if (view === "form") {
        optimisticEdit(qc, flatIndex, patch);
      } else if (replacementRecord) {
        optimisticReplace(qc, flatIndex, {
          ...replacementRecord,
          added_at: game.added_at || replacementRecord.added_at,
        });
      }

      const { commit, shard } = result;
      const sevenSha = commit.sha.slice(0, 7);
      toast.success(t("edit.savedToast", { sha: sevenSha }), {
        id: toastId,
        duration: 15000,
        description: ctx.willSign
          ? `${shard} · ${t("common.verifying")}`
          : `${shard} · ${t("games.unsigned")}`,
        action: {
          label: t("verify.viewCommit"),
          onClick: (event) => {
            event.preventDefault();
            void openExternal(commit.htmlUrl);
          },
        },
      });

      if (ctx.willSign) {
        void pollCommitVerification(commit.sha, auth.token).then((v) => {
          toast.success(t("edit.savedToast", { sha: sevenSha }), {
            id: toastId,
            duration: 15000,
            description: v.verified
              ? `${shard} · ${t("verify.verified")}`
              : `${shard} · ${t("verify.unverifiedReason", { reason: v.reason })}`,
            action: {
              label: t("verify.viewCommit"),
              onClick: (event) => {
                event.preventDefault();
                void openExternal(commit.htmlUrl);
              },
            },
          });
        });
      }

      onClose();
    } catch (err) {
      if (err instanceof RefAdvancedError) {
        toast.error(t("edit.branchAdvanced"), {
          id: toastId,
          description: t("edit.branchAdvancedBody"),
        });
        await qc.invalidateQueries({ queryKey: ["games"] });
        onClose();
      } else {
        toast.error(t("edit.saveFailed"), {
          id: toastId,
          description: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <DialogTitle>
              {t("edit.title", { name: game.name || extractAppid(game.link) })}
            </DialogTitle>
            <ViewToggle view={view} setView={setView} />
          </div>
          <DialogDescription>
            {view === "form" ? t("edit.subtitleForm") : t("edit.subtitleJson")}{" "}
            <a
              href={game.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {t("edit.openOnSteam")} <ExternalLink className="h-3 w-3" />
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {view === "form" ? (
            <EditFormFields form={form} update={update} />
          ) : (
            <EditJsonView
              json={json}
              setJson={(v) => {
                setJson(v);
                validateJson(v);
              }}
              error={jsonError}
            />
          )}

          {showConfirm && (
            <EditChangePreview
              view={view}
              game={game}
              patch={patch}
              parsedJson={parsedJson}
              willSign={!!ctx?.willSign}
            />
          )}

          {!hasChanges && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {view === "form"
                  ? t("edit.noChanges")
                  : jsonError
                    ? t("edit.fixJsonErrors", { error: jsonError })
                    : t("edit.jsonUnchanged")}
              </span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            {!showConfirm ? (
              <Button onClick={() => setShowConfirm(true)} disabled={!hasChanges}>
                <Save className="mr-1 h-3 w-3" /> {t("edit.reviewChanges")}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  disabled={saving}
                >
                  {t("common.back")}
                </Button>
                <Button onClick={save} disabled={saving || !hasChanges}>
                  <Save className="mr-1 h-3 w-3" />
                  {saving ? t("common.saving") : t("edit.commitAndSave")}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
