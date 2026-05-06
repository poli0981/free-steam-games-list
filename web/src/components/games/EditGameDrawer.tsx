import { useEffect, useMemo, useState } from "react";
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
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";
import { Badge } from "../ui/badge";
import { DiffViewer } from "./DiffViewer";
import { useAuth } from "../../stores/auth";
import { useGames } from "../../hooks/useGames";
import { extractAppid } from "../../lib/data-store";
import { updateGameWithRetry, type EditPatch } from "../../lib/edits";
import { ConflictError } from "../../lib/github-api";
import type { GameRecord } from "../../lib/schema";

interface Props {
  game: GameRecord | null;
  onClose: () => void;
}

interface FormState {
  genre: string;
  type_game: "online" | "offline" | "";
  anti_cheat: string;
  anti_cheat_note: string;
  is_kernel_ac: "yes" | "no" | "unknown";
  notes: string;
  safe: "y" | "n" | "?" | "";
  status: "active" | "delisted";
}

function gameToForm(g: GameRecord): FormState {
  return {
    genre: g.genre ?? "",
    type_game: (g.type_game as FormState["type_game"]) ?? "",
    anti_cheat: g.anti_cheat ?? "",
    anti_cheat_note: g.anti_cheat_note ?? "",
    is_kernel_ac:
      g.is_kernel_ac === true ? "yes" : g.is_kernel_ac === false ? "no" : "unknown",
    notes: g.notes ?? "",
    safe: (g.safe as FormState["safe"]) ?? "?",
    status: (g.status === "delisted" ? "delisted" : "active") as FormState["status"],
  };
}

function formToPatch(g: GameRecord, form: FormState): EditPatch {
  const patch: EditPatch = {};
  const isKernelAC =
    form.is_kernel_ac === "yes" ? true : form.is_kernel_ac === "no" ? false : null;

  if (form.genre !== (g.genre ?? "")) patch.genre = form.genre;
  if (form.type_game !== (g.type_game ?? "")) patch.type_game = form.type_game;
  if (form.anti_cheat !== (g.anti_cheat ?? "")) patch.anti_cheat = form.anti_cheat;
  if (form.anti_cheat_note !== (g.anti_cheat_note ?? ""))
    patch.anti_cheat_note = form.anti_cheat_note;
  if (isKernelAC !== (g.is_kernel_ac ?? null)) patch.is_kernel_ac = isKernelAC;
  if (form.notes !== (g.notes ?? "")) patch.notes = form.notes;
  if (form.safe !== (g.safe ?? "?")) patch.safe = form.safe;
  if (form.status !== (g.status === "delisted" ? "delisted" : "active"))
    patch.status = form.status;
  return patch;
}

export function EditGameDrawer({ game, onClose }: Props) {
  const auth = useAuth();
  const games = useGames();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(game ? gameToForm(game) : null);
    setShowConfirm(false);
    setSaving(false);
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

  const hasChanges = Object.keys(patch).length > 0;

  if (!game || !form) return null;

  if (!auth.isAuthenticated) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign in required</DialogTitle>
            <DialogDescription>
              Editing requires GitHub authentication. Go to Settings → Sign in.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  async function save() {
    if (!auth.token || !game || !games.data || flatIndex === -1) return;
    setSaving(true);
    try {
      const result = await updateGameWithRetry({
        record: game,
        patch,
        flatIndex,
        index: games.data.index,
        token: auth.token,
        triggerMarkdownRebuild: true,
      });
      toast.success("Saved · " + result.commitSha.slice(0, 7), {
        description: result.shard,
        action: {
          label: "View commit",
          onClick: () => window.open(result.htmlUrl, "_blank"),
        },
      });
      // Invalidate cache so next refetch pulls fresh data
      await queryClient.invalidateQueries({ queryKey: ["games"] });
      onClose();
    } catch (err) {
      if (err instanceof ConflictError) {
        toast.error("Conflict — data changed remotely", {
          description: "Refetch and re-apply your edits.",
        });
        await queryClient.invalidateQueries({ queryKey: ["games"] });
        onClose();
      } else {
        toast.error("Save failed", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit · {game.name || extractAppid(game.link)}</DialogTitle>
          <DialogDescription>
            Manual fields only. Auto-fetched data (name, reviews, players, etc.) is
            updated by the daily pipeline.{" "}
            <a
              href={game.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open on Steam <ExternalLink className="h-3 w-3" />
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="genre">Genre</Label>
              <Input
                id="genre"
                value={form.genre}
                onChange={(e) => update("genre", e.target.value)}
                placeholder="FPS, MOBA, …"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="type_game">Type</Label>
              <select
                id="type_game"
                value={form.type_game}
                onChange={(e) =>
                  update("type_game", e.target.value as FormState["type_game"])
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">— unknown —</option>
                <option value="online">online</option>
                <option value="offline">offline</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="anti_cheat">Anti-cheat</Label>
              <Input
                id="anti_cheat"
                value={form.anti_cheat}
                onChange={(e) => update("anti_cheat", e.target.value)}
                placeholder="VAC, EAC, BattlEye, … or - if none"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Kernel-level AC?</Label>
              <div className="flex gap-1.5">
                {(["unknown", "no", "yes"] as const).map((v) => (
                  <Button
                    key={v}
                    type="button"
                    size="sm"
                    variant={form.is_kernel_ac === v ? "default" : "outline"}
                    onClick={() => update("is_kernel_ac", v)}
                  >
                    {v}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="anti_cheat_note">Anti-cheat note</Label>
            <Textarea
              id="anti_cheat_note"
              value={form.anti_cheat_note}
              onChange={(e) => update("anti_cheat_note", e.target.value)}
              placeholder="Notes on AC behavior, kernel driver, etc."
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Personal review or comment"
              rows={3}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="safe">Safe?</Label>
              <select
                id="safe"
                value={form.safe}
                onChange={(e) => update("safe", e.target.value as FormState["safe"])}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="?">unknown</option>
                <option value="y">yes</option>
                <option value="n">no</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                value={form.status}
                onChange={(e) =>
                  update("status", e.target.value as FormState["status"])
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="active">active</option>
                <option value="delisted">delisted</option>
              </select>
            </div>
          </div>

          {showConfirm && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Diff preview</Label>
                  <Badge variant="secondary">
                    {Object.keys(patch).length} field
                    {Object.keys(patch).length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <DiffViewer before={game} patch={patch} />
              </div>
            </>
          )}

          {!hasChanges && form && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>No changes yet — adjust a field above to enable Save.</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            {!showConfirm ? (
              <Button
                onClick={() => setShowConfirm(true)}
                disabled={!hasChanges}
              >
                <Save className="mr-1 h-3 w-3" /> Review changes
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  disabled={saving}
                >
                  Back
                </Button>
                <Button onClick={save} disabled={saving || !hasChanges}>
                  <Save className="mr-1 h-3 w-3" />
                  {saving ? "Saving…" : "Commit & save"}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
