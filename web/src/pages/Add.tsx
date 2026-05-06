import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  PlusCircle,
  Sparkles,
  ListPlus,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  FileText,
  Code,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { useAuth } from "../stores/auth";
import { useGames } from "../hooks/useGames";
import { useCommitContext, type CommitContext } from "../hooks/useCommitContext";
import { useIsOwner } from "../hooks/useIsOwner";
import { addLinks, type AddEntry } from "../lib/edits";
import { extractAppid, normalizeLink } from "../lib/data-store";
import { LoadingState } from "../components/common/QueryState";
import { pollCommitVerification } from "../lib/verify-commit";
import {
  ANTI_CHEAT_ENUM,
  GENRE_ENUM,
  TYPE_GAME_ENUM,
  SAFE_ENUM,
} from "../lib/enums";

export function AddPage() {
  const auth = useAuth();
  const ctx = useCommitContext();
  const isOwner = useIsOwner();
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

  if (!isOwner || !auth.isAuthenticated || !ctx) {
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
              {auth.isAuthenticated
                ? "Only the repo owner can add or edit. Visitors browse read-only."
                : "Sign in to GitHub as the repo owner to add games. Read-only browse works without sign-in."}
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
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Add games</h1>
        <p className="text-sm text-muted-foreground">
          Paste Steam links → queues to <code>scripts/temp_info.jsonl</code>. The
          existing <code>ingest-new.yml</code> workflow fetches Steam metadata
          (name, reviews, players, languages, anti-cheat) and merges your
          manual overrides on top. Refresh in ~3–5 minutes to see new rows.
        </p>
        {ctx.willSign ? (
          <Badge variant="success">
            <ShieldCheck className="mr-1 h-3 w-3" /> commits will be signed
          </Badge>
        ) : (
          <Badge variant="warning">
            <ShieldAlert className="mr-1 h-3 w-3" /> commits will be unsigned · unlock GPG in Settings to sign
          </Badge>
        )}
      </div>

      <SingleAdd
        existingAppids={existingAppids}
        ctx={ctx}
        token={auth.token!}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["games"] })}
      />

      <BulkAdd
        existingAppids={existingAppids}
        ctx={ctx}
        token={auth.token!}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["games"] })}
      />
    </div>
  );
}

interface SubProps {
  existingAppids: Set<string>;
  ctx: CommitContext;
  token: string;
  onSuccess: () => void;
}

interface OverrideState {
  genre: string;
  type_game: "online" | "offline" | "";
  anti_cheat: string;
  anti_cheat_note: string;
  is_kernel_ac: "yes" | "no" | "unknown";
  notes: string;
  safe: "y" | "n" | "?" | "";
}

const emptyOverride: OverrideState = {
  genre: "",
  type_game: "",
  anti_cheat: "",
  anti_cheat_note: "",
  is_kernel_ac: "unknown",
  notes: "",
  safe: "?",
};

function overrideToFields(o: OverrideState): Partial<AddEntry> {
  const out: Partial<AddEntry> = {};
  if (o.genre.trim()) out.genre = o.genre.trim();
  if (o.type_game) out.type_game = o.type_game;
  if (o.anti_cheat.trim()) out.anti_cheat = o.anti_cheat.trim();
  if (o.anti_cheat_note.trim()) out.anti_cheat_note = o.anti_cheat_note.trim();
  if (o.is_kernel_ac !== "unknown")
    out.is_kernel_ac = o.is_kernel_ac === "yes";
  if (o.notes.trim()) out.notes = o.notes.trim();
  if (o.safe !== "?") out.safe = o.safe;
  return out;
}

function reportToast(
  toastId: string,
  ctx: CommitContext,
  result: { added: AddEntry[]; commit: { sha: string; htmlUrl: string } },
  token: string,
  label: string,
) {
  const sevenSha = result.commit.sha.slice(0, 7);
  toast.success(label, {
    id: toastId,
    description: ctx.willSign
      ? `${sevenSha} · verifying… · ingest starting`
      : `${sevenSha} · unsigned · ingest starting`,
    action: {
      label: "View commit",
      onClick: () => window.open(result.commit.htmlUrl, "_blank"),
    },
  });
  if (ctx.willSign) {
    void pollCommitVerification(result.commit.sha, token).then((v) => {
      toast.success(label, {
        id: toastId,
        description: v.verified
          ? `${sevenSha} · Verified ✓ · ingest starting`
          : `${sevenSha} · Unverified · ${v.reason}`,
        action: {
          label: "View commit",
          onClick: () => window.open(result.commit.htmlUrl, "_blank"),
        },
      });
    });
  }
}

function SingleAdd({ existingAppids, ctx, token, onSuccess }: SubProps) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);
  const [override, setOverride] = useState<OverrideState>(emptyOverride);

  const normalized = link.trim() ? normalizeLink(link.trim()) : null;
  const appid = normalized ? extractAppid(normalized) : null;
  const dup = appid ? existingAppids.has(appid) : false;
  const valid = !!normalized && !dup;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!normalized) return;
    setBusy(true);
    const toastId = `add-single-${Date.now()}`;
    try {
      const entry: AddEntry = { link: normalized, ...overrideToFields(override) };
      const result = await addLinks({
        entries: [entry],
        existingAppids,
        author: ctx.author,
        signer: ctx.signer,
        token,
      });
      reportToast(toastId, ctx, result, token, `Queued ${result.added.length} game`);
      setLink("");
      setOverride(emptyOverride);
      setShowOverrides(false);
      onSuccess();
    } catch (err) {
      toast.error("Add failed", {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  function setOv<K extends keyof OverrideState>(k: K, v: OverrideState[K]) {
    setOverride((s) => ({ ...s, [k]: v }));
  }

  const overrideFieldsCount = Object.values(overrideToFields(override)).filter(
    (v) => v !== undefined,
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlusCircle className="h-4 w-4" /> Single add
        </CardTitle>
        <CardDescription>
          Paste a Steam URL or appid. Optional: pre-fill manual fields so the
          ingest pipeline preserves them.
        </CardDescription>
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

          <button
            type="button"
            onClick={() => setShowOverrides((s) => !s)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showOverrides ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Manual overrides
            {overrideFieldsCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {overrideFieldsCount} set
              </Badge>
            )}
          </button>

          {showOverrides && (
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <OverrideFields ov={override} setOv={setOv} disabled={busy} />
              <p className="text-xs text-muted-foreground">
                Empty values are skipped — the daily pipeline will fetch defaults from
                Steam. Anything you set here is preserved across refetches.
              </p>
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

interface BulkPreview {
  valid: AddEntry[];
  dup: number;
  bad: { line: string; reason: string }[];
}

function previewLinks(text: string, existing: Set<string>): BulkPreview {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const valid: AddEntry[] = [];
  const bad: { line: string; reason: string }[] = [];
  let dup = 0;
  const seen = new Set<string>();
  for (const line of lines) {
    const norm = normalizeLink(line);
    if (!norm) {
      bad.push({ line, reason: "not a valid Steam link" });
      continue;
    }
    const aid = extractAppid(norm);
    if (!aid) {
      bad.push({ line, reason: "no appid" });
      continue;
    }
    if (existing.has(aid)) {
      dup++;
      continue;
    }
    if (seen.has(aid)) continue;
    seen.add(aid);
    valid.push({ link: norm });
  }
  return { valid, dup, bad };
}

function previewJsonl(text: string, existing: Set<string>): BulkPreview {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const valid: AddEntry[] = [];
  const bad: { line: string; reason: string }[] = [];
  let dup = 0;
  const seen = new Set<string>();
  for (const line of lines) {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      bad.push({
        line,
        reason: `bad JSON · ${e instanceof Error ? e.message : "parse error"}`,
      });
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      bad.push({ line, reason: "not an object" });
      continue;
    }
    const r = obj as Record<string, unknown>;
    if (typeof r.link !== "string") {
      bad.push({ line, reason: "missing 'link' string" });
      continue;
    }
    const norm = normalizeLink(r.link);
    if (!norm) {
      bad.push({ line, reason: "invalid link" });
      continue;
    }
    const aid = extractAppid(norm);
    if (!aid) {
      bad.push({ line, reason: "no appid" });
      continue;
    }
    if (existing.has(aid)) {
      dup++;
      continue;
    }
    if (seen.has(aid)) continue;
    seen.add(aid);
    valid.push({ ...(r as unknown as AddEntry), link: norm });
  }
  return { valid, dup, bad };
}

type BulkMode = "links" | "json";

function BulkAdd({ existingAppids, ctx, token, onSuccess }: SubProps) {
  const [mode, setMode] = useState<BulkMode>("links");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = useMemo(
    () =>
      mode === "links"
        ? previewLinks(text, existingAppids)
        : previewJsonl(text, existingAppids),
    [text, existingAppids, mode],
  );

  async function submit() {
    if (preview.valid.length === 0) return;
    setBusy(true);
    const toastId = `add-bulk-${Date.now()}`;
    try {
      const result = await addLinks({
        entries: preview.valid,
        existingAppids,
        author: ctx.author,
        signer: ctx.signer,
        token,
      });
      reportToast(
        toastId,
        ctx,
        result,
        token,
        `Queued ${result.added.length} games`,
      );
      setText("");
      onSuccess();
    } catch (err) {
      toast.error("Bulk add failed", {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  const placeholder =
    mode === "links"
      ? `730\nhttps://store.steampowered.com/app/570/\n440`
      : `{"link":"730","genre":"FPS","type_game":"online","anti_cheat":"VAC","is_kernel_ac":false}\n{"link":"570","genre":"MOBA"}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListPlus className="h-4 w-4" /> Bulk add
            </CardTitle>
            <CardDescription>
              {mode === "links"
                ? "One Steam URL or appid per line."
                : "One JSON object per line with link + optional manual fields."}
            </CardDescription>
          </div>
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("links")}
              className={
                "flex items-center gap-1 rounded px-2 py-0.5 " +
                (mode === "links"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <FileText className="h-3 w-3" /> Links
            </button>
            <button
              type="button"
              onClick={() => setMode("json")}
              className={
                "flex items-center gap-1 rounded px-2 py-0.5 " +
                (mode === "json"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <Code className="h-3 w-3" /> JSON
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={8}
          className="font-mono text-xs"
          spellCheck={false}
        />

        {text.trim() && (
          <>
            <Separator />
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat label="Valid new" value={preview.valid.length} variant="success" />
              <Stat label="Already in dataset" value={preview.dup} variant="warning" />
              <Stat label="Invalid" value={preview.bad.length} variant="destructive" />
            </div>

            {preview.bad.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                <div className="mb-1 font-semibold">Invalid lines (skipped):</div>
                <ul className="space-y-0.5 font-mono text-destructive/90">
                  {preview.bad.slice(0, 5).map((b, i) => (
                    <li key={i} className="truncate">
                      {b.line} <span className="opacity-70">— {b.reason}</span>
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

interface OverrideFieldsProps {
  ov: OverrideState;
  setOv: <K extends keyof OverrideState>(k: K, v: OverrideState[K]) => void;
  disabled: boolean;
}

function OverrideFields({ ov, setOv, disabled }: OverrideFieldsProps) {
  const isCustomAC = !(ANTI_CHEAT_ENUM as readonly string[]).includes(ov.anti_cheat);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ov-genre">Genre</Label>
          <Input
            id="ov-genre"
            list="ov-genre-list"
            value={ov.genre}
            onChange={(e) => setOv("genre", e.target.value)}
            disabled={disabled}
            placeholder="Pick or type…"
          />
          <datalist id="ov-genre-list">
            {GENRE_ENUM.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ov-type">Type</Label>
          <select
            id="ov-type"
            value={ov.type_game}
            onChange={(e) =>
              setOv("type_game", e.target.value as OverrideState["type_game"])
            }
            disabled={disabled}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            {TYPE_GAME_ENUM.map((t) => (
              <option key={t || "u"} value={t}>
                {t || "— skip —"}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ov-ac">Anti-cheat</Label>
          <select
            id="ov-ac"
            value={isCustomAC && ov.anti_cheat ? "__custom__" : ov.anti_cheat || ""}
            onChange={(e) => {
              if (e.target.value === "__custom__") setOv("anti_cheat", "");
              else setOv("anti_cheat", e.target.value);
            }}
            disabled={disabled}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="">— skip —</option>
            {ANTI_CHEAT_ENUM.map((a) => (
              <option key={a} value={a}>
                {a === "-" ? "— none —" : a}
              </option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
          {isCustomAC && ov.anti_cheat && (
            <Input
              value={ov.anti_cheat}
              onChange={(e) => setOv("anti_cheat", e.target.value)}
              disabled={disabled}
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
                variant={ov.is_kernel_ac === v ? "default" : "outline"}
                onClick={() => setOv("is_kernel_ac", v)}
                disabled={disabled}
              >
                {v}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ov-safe">Safe?</Label>
          <select
            id="ov-safe"
            value={ov.safe}
            onChange={(e) => setOv("safe", e.target.value as OverrideState["safe"])}
            disabled={disabled}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            {SAFE_ENUM.map((s) => (
              <option key={s} value={s}>
                {s === "?" ? "— skip —" : s === "y" ? "yes" : "no"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ov-acn">Anti-cheat note</Label>
        <Textarea
          id="ov-acn"
          value={ov.anti_cheat_note}
          onChange={(e) => setOv("anti_cheat_note", e.target.value)}
          disabled={disabled}
          rows={2}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ov-notes">Notes</Label>
        <Textarea
          id="ov-notes"
          value={ov.notes}
          onChange={(e) => setOv("notes", e.target.value)}
          disabled={disabled}
          rows={2}
        />
      </div>
    </>
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
