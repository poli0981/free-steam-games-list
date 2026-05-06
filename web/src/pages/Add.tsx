import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, PlusCircle, Sparkles, ListPlus, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { useAuth } from "../stores/auth";
import { useGames } from "../hooks/useGames";
import { addLinks } from "../lib/edits";
import { extractAppid, normalizeLink } from "../lib/data-store";
import { LoadingState } from "../components/common/QueryState";

export function AddPage() {
  const auth = useAuth();
  const games = useGames();
  const queryClient = useQueryClient();

  const existingAppids = useMemo(() => {
    const set = new Set<string>();
    if (!games.data) return set;
    for (const aid of games.data.appidIndex.keys()) set.add(aid);
    return set;
  }, [games.data]);

  if (games.isLoading) return <LoadingState />;
  if (!games.data) return null;

  if (!auth.isAuthenticated) {
    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Add games</h1>
          <p className="text-sm text-muted-foreground">
            Paste a Steam link → it gets queued for the daily ingest pipeline.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Sign in to GitHub to add games. Read-only browse works without sign-in.
            </p>
            <Button onClick={() => (window.location.hash = "#/settings")}>
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add games</h1>
        <p className="text-sm text-muted-foreground">
          Paste Steam links — they queue to <code>scripts/temp_info.jsonl</code>. The
          existing <code>ingest-new.yml</code> workflow fetches full Steam metadata
          (name, reviews, players, languages, anti-cheat) and merges it into the data
          shards. Refresh this page in ~3–5 minutes to see new rows.
        </p>
      </div>

      <SingleAdd
        existingAppids={existingAppids}
        token={auth.token!}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["games"] })}
      />

      <BulkAdd
        existingAppids={existingAppids}
        token={auth.token!}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["games"] })}
      />
    </div>
  );
}

interface SubProps {
  existingAppids: Set<string>;
  token: string;
  onSuccess: () => void;
}

function SingleAdd({ existingAppids, token, onSuccess }: SubProps) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  const normalized = link.trim() ? normalizeLink(link.trim()) : null;
  const appid = normalized ? extractAppid(normalized) : null;
  const dup = appid ? existingAppids.has(appid) : false;
  const valid = !!normalized && !dup;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!normalized) return;
    setBusy(true);
    try {
      const result = await addLinks([normalized], existingAppids, token);
      toast.success(`Queued ${result.added.length} game`, {
        description: `Commit ${result.commitSha.slice(0, 7)} — ingest workflow starting`,
      });
      setLink("");
      onSuccess();
    } catch (err) {
      toast.error("Add failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlusCircle className="h-4 w-4" /> Single add
        </CardTitle>
        <CardDescription>Paste a Steam URL or appid.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="link">Steam link or appid</Label>
            <Input
              id="link"
              placeholder="https://store.steampowered.com/app/730/  or just  730"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={busy}
            />
          </div>

          {link.trim() && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              {normalized ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-muted-foreground">{normalized}</span>
                  {dup ? (
                    <Badge variant="warning">already in dataset</Badge>
                  ) : (
                    <Badge variant="success">new · appid {appid}</Badge>
                  )}
                </div>
              ) : (
                <span className="text-destructive">Not a valid Steam link.</span>
              )}
            </div>
          )}

          <Button type="submit" disabled={!valid || busy}>
            {busy ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3 w-3" />
            )}
            {busy ? "Queueing…" : "Queue for ingest"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BulkAdd({ existingAppids, token, onSuccess }: SubProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const valid: string[] = [];
    const dup: string[] = [];
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const norm = normalizeLink(line);
      if (!norm) {
        bad.push(line);
        continue;
      }
      const aid = extractAppid(norm);
      if (!aid) {
        bad.push(line);
        continue;
      }
      if (existingAppids.has(aid)) {
        dup.push(aid);
        continue;
      }
      if (seen.has(aid)) continue;
      seen.add(aid);
      valid.push(norm);
    }
    return { valid, dup, bad };
  }, [text, existingAppids]);

  async function submit() {
    if (preview.valid.length === 0) return;
    setBusy(true);
    try {
      const result = await addLinks(preview.valid, existingAppids, token);
      toast.success(`Queued ${result.added.length} games`, {
        description: `Commit ${result.commitSha.slice(0, 7)} — ingest workflow starting`,
        action: {
          label: "View runs",
          onClick: () =>
            window.open(
              "https://github.com/poli0981/free-steam-games-list/actions/workflows/ingest-new.yml",
              "_blank",
            ),
        },
      });
      setText("");
      onSuccess();
    } catch (err) {
      toast.error("Bulk add failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListPlus className="h-4 w-4" /> Bulk add
        </CardTitle>
        <CardDescription>
          One Steam URL or appid per line. Duplicates and invalid lines are skipped.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          placeholder={`730\nhttps://store.steampowered.com/app/570/\n440`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={8}
          className="font-mono text-xs"
        />

        {text.trim() && (
          <>
            <Separator />
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat label="Valid new" value={preview.valid.length} variant="success" />
              <Stat label="Already in dataset" value={preview.dup.length} variant="warning" />
              <Stat label="Invalid" value={preview.bad.length} variant="destructive" />
            </div>

            {preview.bad.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                <div className="mb-1 font-semibold">Invalid lines (skipped):</div>
                <ul className="space-y-0.5 font-mono text-destructive/90">
                  {preview.bad.slice(0, 5).map((b, i) => (
                    <li key={i} className="truncate">
                      {b}
                    </li>
                  ))}
                  {preview.bad.length > 5 && (
                    <li>+{preview.bad.length - 5} more…</li>
                  )}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={submit} disabled={preview.valid.length === 0 || busy}>
            {busy ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3 w-3" />
            )}
            {busy
              ? "Queueing…"
              : `Queue ${preview.valid.length} game${preview.valid.length === 1 ? "" : "s"}`}
          </Button>
          <a
            href="https://github.com/poli0981/free-steam-games-list/actions/workflows/ingest-new.yml"
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View ingest runs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "success" | "warning" | "destructive";
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <Badge variant={variant}>{label}</Badge>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
