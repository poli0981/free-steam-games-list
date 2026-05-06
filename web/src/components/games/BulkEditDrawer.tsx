import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, AlertCircle, ShieldCheck, ShieldAlert } from "lucide-react";
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
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { useAuth } from "../../stores/auth";
import { useGames } from "../../hooks/useGames";
import { useCommitContext } from "../../hooks/useCommitContext";
import { bulkEditGames, type EditPatch } from "../../lib/edits";

interface Props {
  appids: string[];
  onClose: () => void;
  onCommitted: () => void;
}

interface FieldState<T> {
  enabled: boolean;
  value: T;
}

interface BulkForm {
  genre: FieldState<string>;
  type_game: FieldState<"online" | "offline" | "">;
  anti_cheat: FieldState<string>;
  is_kernel_ac: FieldState<"yes" | "no" | "unknown">;
  notes: FieldState<string>;
  safe: FieldState<"y" | "n" | "?" | "">;
  status: FieldState<"active" | "delisted">;
}

const emptyForm: BulkForm = {
  genre: { enabled: false, value: "" },
  type_game: { enabled: false, value: "" },
  anti_cheat: { enabled: false, value: "" },
  is_kernel_ac: { enabled: false, value: "unknown" },
  notes: { enabled: false, value: "" },
  safe: { enabled: false, value: "?" },
  status: { enabled: false, value: "active" },
};

function formToPatch(form: BulkForm): EditPatch {
  const patch: EditPatch = {};
  if (form.genre.enabled) patch.genre = form.genre.value;
  if (form.type_game.enabled) patch.type_game = form.type_game.value;
  if (form.anti_cheat.enabled) patch.anti_cheat = form.anti_cheat.value;
  if (form.is_kernel_ac.enabled) {
    patch.is_kernel_ac =
      form.is_kernel_ac.value === "yes"
        ? true
        : form.is_kernel_ac.value === "no"
          ? false
          : null;
  }
  if (form.notes.enabled) patch.notes = form.notes.value;
  if (form.safe.enabled) patch.safe = form.safe.value;
  if (form.status.enabled) patch.status = form.status.value;
  return patch;
}

export function BulkEditDrawer({ appids, onClose, onCommitted }: Props) {
  const auth = useAuth();
  const ctx = useCommitContext();
  const games = useGames();
  const qc = useQueryClient();
  const [form, setForm] = useState<BulkForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const patch = useMemo(() => formToPatch(form), [form]);
  const enabledCount = Object.values(form).filter((f) => f.enabled).length;

  const shardsAffected = useMemo(() => {
    if (!games.data) return 0;
    const shards = new Set<string>();
    for (const aid of appids) {
      const flatIdx = games.data.appidIndex.get(aid);
      if (flatIdx === undefined) continue;
      // Reuse exact same logic as bulk edit
      let cum = 0;
      for (const f of games.data.index.files) {
        if (flatIdx < cum + f.count) {
          shards.add(f.name);
          break;
        }
        cum += f.count;
      }
    }
    return shards.size;
  }, [appids, games.data]);

  function set<K extends keyof BulkForm>(key: K, patch: Partial<BulkForm[K]>) {
    setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  }

  async function save() {
    if (!auth.token || !ctx || !games.data) return;
    if (enabledCount === 0) {
      toast.error("No fields enabled");
      return;
    }
    setSaving(true);
    try {
      const result = await bulkEditGames({
        appids,
        patch,
        appidIndex: games.data.appidIndex,
        index: games.data.index,
        author: ctx.author,
        signer: ctx.signer,
        token: auth.token,
        triggerMarkdownRebuild: true,
      });
      toast.success(`Bulk edited ${result.modified} games`, {
        description: `${result.commit.sha.slice(0, 7)} · ${result.commit.verified ? "Verified" : "Unverified"} · ${result.shardsTouched.length} shard${result.shardsTouched.length === 1 ? "" : "s"}`,
        action: {
          label: "View commit",
          onClick: () => window.open(result.commit.htmlUrl, "_blank"),
        },
      });
      await qc.invalidateQueries({ queryKey: ["games"] });
      onCommitted();
    } catch (err) {
      toast.error("Bulk edit failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk edit · {appids.length} games</DialogTitle>
          <DialogDescription>
            Toggle fields you want to update. Disabled fields stay as-is on each
            record. Edit lands in <strong>{shardsAffected}</strong> shard
            {shardsAffected === 1 ? "" : "s"} as one commit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <BulkField
            label="Genre"
            enabled={form.genre.enabled}
            onToggle={(v) => set("genre", { enabled: v })}
          >
            <Input
              value={form.genre.value}
              onChange={(e) => set("genre", { value: e.target.value })}
              disabled={!form.genre.enabled}
              placeholder="FPS, MOBA, …"
            />
          </BulkField>

          <BulkField
            label="Type"
            enabled={form.type_game.enabled}
            onToggle={(v) => set("type_game", { enabled: v })}
          >
            <select
              value={form.type_game.value}
              onChange={(e) =>
                set("type_game", { value: e.target.value as "online" | "offline" | "" })
              }
              disabled={!form.type_game.enabled}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm disabled:opacity-50"
            >
              <option value="">— unknown —</option>
              <option value="online">online</option>
              <option value="offline">offline</option>
            </select>
          </BulkField>

          <BulkField
            label="Anti-cheat"
            enabled={form.anti_cheat.enabled}
            onToggle={(v) => set("anti_cheat", { enabled: v })}
          >
            <Input
              value={form.anti_cheat.value}
              onChange={(e) => set("anti_cheat", { value: e.target.value })}
              disabled={!form.anti_cheat.enabled}
              placeholder="VAC, EAC, BattlEye, … or - if none"
            />
          </BulkField>

          <BulkField
            label="Kernel-level AC?"
            enabled={form.is_kernel_ac.enabled}
            onToggle={(v) => set("is_kernel_ac", { enabled: v })}
          >
            <div className="flex gap-1.5">
              {(["unknown", "no", "yes"] as const).map((v) => (
                <Button
                  key={v}
                  type="button"
                  size="sm"
                  variant={form.is_kernel_ac.value === v ? "default" : "outline"}
                  onClick={() => set("is_kernel_ac", { value: v })}
                  disabled={!form.is_kernel_ac.enabled}
                >
                  {v}
                </Button>
              ))}
            </div>
          </BulkField>

          <BulkField
            label="Notes (replaces existing)"
            enabled={form.notes.enabled}
            onToggle={(v) => set("notes", { enabled: v })}
          >
            <Textarea
              value={form.notes.value}
              onChange={(e) => set("notes", { value: e.target.value })}
              disabled={!form.notes.enabled}
              rows={2}
            />
          </BulkField>

          <BulkField
            label="Safe?"
            enabled={form.safe.enabled}
            onToggle={(v) => set("safe", { enabled: v })}
          >
            <select
              value={form.safe.value}
              onChange={(e) =>
                set("safe", { value: e.target.value as "y" | "n" | "?" | "" })
              }
              disabled={!form.safe.enabled}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm disabled:opacity-50"
            >
              <option value="?">unknown</option>
              <option value="y">yes</option>
              <option value="n">no</option>
            </select>
          </BulkField>

          <BulkField
            label="Status"
            enabled={form.status.enabled}
            onToggle={(v) => set("status", { enabled: v })}
          >
            <select
              value={form.status.value}
              onChange={(e) =>
                set("status", { value: e.target.value as "active" | "delisted" })
              }
              disabled={!form.status.enabled}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm disabled:opacity-50"
            >
              <option value="active">active</option>
              <option value="delisted">delisted</option>
            </select>
          </BulkField>

          <Separator />

          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3 text-xs">
            <span className="text-muted-foreground">
              Will commit <strong>{enabledCount}</strong> field
              {enabledCount === 1 ? "" : "s"} across {appids.length} games.
            </span>
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

          {enabledCount === 0 && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              Enable at least one field to apply a bulk edit.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || enabledCount === 0}>
              <Save className="mr-1 h-3 w-3" />
              {saving ? "Saving…" : `Commit & save · ${appids.length} games`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkField({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-md border p-2 transition-colors data-[on=true]:border-primary/50 data-[on=true]:bg-primary/5"
      data-on={enabled ? "true" : "false"}
    >
      <Label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-input bg-transparent accent-primary"
        />
        {label}
      </Label>
      {children}
    </div>
  );
}
