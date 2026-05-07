import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Pencil,
  Trash2,
  X,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  CheckSquare,
} from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { useFilters } from "../../stores/filters";
import { useGames } from "../../hooks/useGames";
import { useAuth } from "../../stores/auth";
import { useCommitContext } from "../../hooks/useCommitContext";
import { useIsOwner } from "../../hooks/useIsOwner";
import { bulkDeleteGames } from "../../lib/edits";
import { optimisticBulkDelete } from "../../lib/optimistic";
import { pollCommitVerification } from "../../lib/verify-commit";
import { BulkEditDrawer } from "./BulkEditDrawer";

interface Props {
  visibleAppids: string[];
}

export function BulkActionBar({ visibleAppids }: Props) {
  const selected = useFilters((s) => s.selected);
  const selectAll = useFilters((s) => s.selectAll);
  const clearSelection = useFilters((s) => s.clearSelection);
  const auth = useAuth();
  const ctx = useCommitContext();
  const isOwner = useIsOwner();
  const games = useGames();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Hide bulk affordances entirely for non-owners — they can't push anyway.
  if (!isOwner) return null;

  if (selected.size === 0) {
    if (visibleAppids.length === 0) return null;
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => selectAll(visibleAppids)}
          className="h-7 text-xs"
        >
          <CheckSquare className="mr-1 h-3 w-3" />
          Select all visible ({visibleAppids.length})
        </Button>
      </div>
    );
  }

  const canEdit = auth.isAuthenticated && !!ctx;

  async function handleDelete() {
    if (!auth.token || !ctx || !games.data) return;
    if (
      !window.confirm(
        `Delete ${selected.size} game${selected.size === 1 ? "" : "s"} from data shards?\nThe records also get appended to scripts/removed_games.jsonl.\n\nThis is destructive — cannot be undone via the UI.`,
      )
    )
      return;
    setDeleting(true);
    const toastId = `delete-${Date.now()}`;
    try {
      const result = await bulkDeleteGames({
        appids: Array.from(selected),
        appidIndex: games.data.appidIndex,
        index: games.data.index,
        author: ctx.author,
        signer: ctx.signer,
        token: auth.token,
      });
      const sevenSha = result.commit.sha.slice(0, 7);
      toast.success(`Deleted ${result.removed} games`, {
        id: toastId,
        description: ctx.willSign
          ? `${sevenSha} · verifying…`
          : `${sevenSha} · unsigned`,
        action: {
          label: "View commit",
          onClick: () => window.open(result.commit.htmlUrl, "_blank"),
        },
      });
      if (ctx.willSign) {
        void pollCommitVerification(result.commit.sha, auth.token).then((v) => {
          toast.success(`Deleted ${result.removed} games`, {
            id: toastId,
            description: v.verified
              ? `${sevenSha} · Verified ✓`
              : `${sevenSha} · Unverified · ${v.reason}`,
            action: {
              label: "View commit",
              onClick: () => window.open(result.commit.htmlUrl, "_blank"),
            },
          });
        });
      }
      // Patch local cache instead of invalidating; raw.github CDN is stale
      // for ~5 min after our commit. See lib/optimistic.ts.
      optimisticBulkDelete(qc, Array.from(selected));
      clearSelection();
    } catch (err) {
      toast.error("Bulk delete failed", {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-primary/10 p-2">
      <Badge variant="default" className="text-sm">
        {selected.size} selected
      </Badge>

      {ctx?.willSign ? (
        <Badge variant="success" className="text-xs">
          <ShieldCheck className="mr-1 h-3 w-3" /> will sign
        </Badge>
      ) : (
        <Badge variant="warning" className="text-xs">
          <ShieldAlert className="mr-1 h-3 w-3" /> unsigned
        </Badge>
      )}

      <div className="ml-auto flex gap-1.5">
        <Button
          size="sm"
          variant="default"
          disabled={!canEdit || deleting}
          onClick={() => setEditing(true)}
        >
          <Pencil className="mr-1 h-3 w-3" /> Bulk edit
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={!canEdit || deleting}
          onClick={handleDelete}
        >
          {deleting ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="mr-1 h-3 w-3" />
          )}
          Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={clearSelection}>
          <X className="mr-1 h-3 w-3" /> Clear
        </Button>
      </div>

      {editing && (
        <BulkEditDrawer
          appids={Array.from(selected)}
          onClose={() => setEditing(false)}
          onCommitted={() => {
            clearSelection();
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
