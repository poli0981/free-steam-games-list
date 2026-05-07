import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Save,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Code,
} from "lucide-react";
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
import { useCommitContext } from "../../hooks/useCommitContext";
import { extractAppid } from "../../lib/data-store";
import {
  updateGame,
  replaceGame,
  RefAdvancedError,
  type EditPatch,
} from "../../lib/edits";
import { optimisticEdit, optimisticReplace } from "../../lib/optimistic";
import { pollCommitVerification } from "../../lib/verify-commit";
import {
  ANTI_CHEAT_ENUM,
  GENRE_ENUM,
  TYPE_GAME_ENUM,
  SAFE_ENUM,
  STATUS_ENUM,
} from "../../lib/enums";
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

type View = "form" | "json";

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
            <DialogTitle>Sign in required</DialogTitle>
            <DialogDescription>
              Editing requires GitHub authentication. Go to Settings → Sign in.
            </DialogDescription>
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
    setForm((f) => (f ? { ...f, [key]: value } : f));
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

      // Patch the local cache directly — raw.githubusercontent.com is
      // Fastly-cached for up to 5 minutes, so a refetch right now would
      // most likely return the pre-edit shard. We already have the new
      // data in hand, so write it straight to TanStack + IndexedDB.
      if (view === "form") {
        optimisticEdit(qc, flatIndex, patch);
      } else if (replacementRecord) {
        optimisticReplace(qc, flatIndex, {
          ...replacementRecord,
          // Preserve added_at to match what we wrote on disk.
          added_at: game.added_at || replacementRecord.added_at,
        });
      }

      const { commit, shard } = result;
      const sevenSha = commit.sha.slice(0, 7);
      toast.success(`Saved ${sevenSha}`, {
        id: toastId,
        description: ctx.willSign ? `${shard} · verifying…` : `${shard} · unsigned`,
        action: {
          label: "View commit",
          onClick: () => window.open(commit.htmlUrl, "_blank"),
        },
      });

      if (ctx.willSign) {
        // Background poll — toast updates by id when done.
        void pollCommitVerification(commit.sha, auth.token).then((v) => {
          toast.success(`Saved ${sevenSha}`, {
            id: toastId,
            description: v.verified
              ? `${shard} · Verified ✓`
              : `${shard} · Unverified · ${v.reason}`,
            action: {
              label: "View commit",
              onClick: () => window.open(commit.htmlUrl, "_blank"),
            },
          });
        });
      }

      onClose();
    } catch (err) {
      if (err instanceof RefAdvancedError) {
        toast.error("Branch advanced — refetch and retry", {
          id: toastId,
          description: "The daily pipeline committed while you were editing.",
        });
        // Real refetch is fine here — we lost the race and need fresh state.
        await qc.invalidateQueries({ queryKey: ["games"] });
        onClose();
      } else {
        toast.error("Save failed", {
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
            <DialogTitle>Edit · {game.name || extractAppid(game.link)}</DialogTitle>
            <ViewToggle view={view} setView={setView} />
          </div>
          <DialogDescription>
            {view === "form" ? (
              <>
                Manual fields only. Auto-fetched data (name, reviews, players, etc.)
                is updated by the daily pipeline.{" "}
              </>
            ) : (
              <>
                Full record JSON. Editing auto-fetched fields will be overwritten on
                next daily refetch unless you also disable the pipeline.{" "}
              </>
            )}
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
          {view === "form" ? (
            <FormFields form={form} update={update} />
          ) : (
            <JsonEditor
              json={json}
              setJson={(v) => {
                setJson(v);
                validateJson(v);
              }}
              error={jsonError}
            />
          )}

          {showConfirm && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Diff preview</Label>
                  <div className="flex items-center gap-1.5">
                    {view === "form" && (
                      <Badge variant="secondary">
                        {Object.keys(patch).length} field
                        {Object.keys(patch).length === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {ctx?.willSign ? (
                      <Badge variant="success">
                        <ShieldCheck className="mr-1 h-3 w-3" /> will sign
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <ShieldAlert className="mr-1 h-3 w-3" /> unsigned
                      </Badge>
                    )}
                  </div>
                </div>
                {view === "form" ? (
                  <DiffViewer before={game} patch={patch} />
                ) : (
                  <JsonDiff before={game} after={parsedJson} />
                )}
                {!ctx?.willSign && (
                  <p className="text-xs text-muted-foreground">
                    GPG key not unlocked — this commit will land but show as
                    Unverified on GitHub.{" "}
                    <a href="#/settings" className="text-primary hover:underline">
                      Unlock in Settings
                    </a>{" "}
                    to sign.
                  </p>
                )}
              </div>
            </>
          )}

          {!hasChanges && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {view === "form"
                  ? "No changes yet — adjust a field above to enable Save."
                  : jsonError
                    ? `Fix JSON errors before saving: ${jsonError}`
                    : "JSON unchanged."}
              </span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            {!showConfirm ? (
              <Button onClick={() => setShowConfirm(true)} disabled={!hasChanges}>
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

function ViewToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setView("form")}
        className={
          "flex items-center gap-1 rounded px-2 py-0.5 " +
          (view === "form"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground")
        }
      >
        <FileText className="h-3 w-3" /> Form
      </button>
      <button
        type="button"
        onClick={() => setView("json")}
        className={
          "flex items-center gap-1 rounded px-2 py-0.5 " +
          (view === "json"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground")
        }
      >
        <Code className="h-3 w-3" /> JSON
      </button>
    </div>
  );
}

interface FormFieldsProps {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}

function FormFields({ form, update }: FormFieldsProps) {
  const isCustomAC = !(ANTI_CHEAT_ENUM as readonly string[]).includes(form.anti_cheat);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="genre">Genre</Label>
          <Input
            id="genre"
            list="genre-list"
            value={form.genre}
            onChange={(e) => update("genre", e.target.value)}
            placeholder="Pick or type a genre…"
          />
          <datalist id="genre-list">
            {GENRE_ENUM.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
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
            {TYPE_GAME_ENUM.map((t) => (
              <option key={t || "unknown"} value={t}>
                {t || "— unknown —"}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="anti_cheat">Anti-cheat</Label>
          <select
            id="anti_cheat"
            value={isCustomAC ? "__custom__" : form.anti_cheat}
            onChange={(e) => {
              if (e.target.value === "__custom__") update("anti_cheat", "");
              else update("anti_cheat", e.target.value);
            }}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            {ANTI_CHEAT_ENUM.map((a) => (
              <option key={a} value={a}>
                {a === "-" ? "— none —" : a}
              </option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
          {isCustomAC && (
            <Input
              value={form.anti_cheat}
              onChange={(e) => update("anti_cheat", e.target.value)}
              placeholder="Custom AC name"
              className="mt-1"
            />
          )}
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
            {SAFE_ENUM.map((s) => (
              <option key={s} value={s}>
                {s === "?" ? "unknown" : s === "y" ? "yes" : "no"}
              </option>
            ))}
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

function JsonEditor({
  json,
  setJson,
  error,
}: {
  json: string;
  setJson: (s: string) => void;
  error: string | null;
}) {
  return (
    <div className="space-y-2">
      <Textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={20}
        spellCheck={false}
        className="font-mono text-[11px] leading-snug"
      />
      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          Power-user mode: replaces the entire record. <code>added_at</code> is
          preserved from the original; everything else is committed verbatim.
        </div>
      )}
    </div>
  );
}

function JsonDiff({
  before,
  after,
}: {
  before: GameRecord;
  after: GameRecord | null;
}) {
  if (!after)
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        No valid JSON to diff.
      </div>
    );
  const changed: { field: string; old: unknown; new: unknown }[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of allKeys) {
    const a = (before as unknown as Record<string, unknown>)[k];
    const b = (after as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed.push({ field: k, old: a, new: b });
    }
  }
  if (changed.length === 0)
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        No changes.
      </div>
    );
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Field</th>
            <th className="px-3 py-2 text-left">Before</th>
            <th className="px-3 py-2 text-left">After</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((c) => (
            <tr key={c.field} className="border-t align-top">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {c.field}
              </td>
              <td className="bg-rose-500/10 px-3 py-2 text-rose-300 font-mono text-[11px] break-all">
                {JSON.stringify(c.old)}
              </td>
              <td className="bg-emerald-500/10 px-3 py-2 text-emerald-300 font-mono text-[11px] break-all">
                {JSON.stringify(c.new)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
