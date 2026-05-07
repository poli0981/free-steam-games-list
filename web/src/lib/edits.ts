/**
 * High-level edit/add operations using the Git Data API.
 *
 *   • Reads use the Contents API (cheap, returns sha for diagnostic only).
 *   • Writes use commitFileWithRetry → blob → tree → commit (signed if signer
 *     provided) → update ref. Signed commits get a "Verified" badge from GitHub.
 *   • After each successful edit commit, dispatches update-daily.yml so the
 *     markdown tables in games/ stay in sync with the data shards.
 */
import { dispatchWorkflow } from "./github-api";
import {
  commitFileWithRetry,
  commitFilesWithRetry,
  getRepoFileText,
  RefAdvancedError,
  type CommitResult,
} from "./git-data";
import {
  shardForFlatIndex,
  parseShardJsonl,
  serializeShardJsonl,
  findRecordIndexByAppid,
} from "./jsonl-shard";
import { extractAppid, normalizeLink } from "./data-store";
import { TEMP_JSONL, DATA_DIR, type DataIndex, type GameRecord } from "./schema";

const INDEX_PATH = `${DATA_DIR}/index.json`;

function nowIsoSeconds(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Read the current data/index.json, bump its last_updated, and return the
 * file entry to include in a commit. Optional deltas adjust total + per-shard
 * counts (used for bulk delete). Other fields stay as the pipeline left them.
 *
 * Why this matters:
 *   useGames keys its IndexedDB cache on `last_updated`. If we commit a shard
 *   without bumping it, every browser tab on the site will keep serving the
 *   pre-edit cached records on next reload — even when the SW serves a fresh
 *   shard fetch — because isCacheFresh() returns true. Bumping the manifest
 *   is the canonical signal that "data changed".
 */
async function bumpedIndexFile(
  token: string | null,
  deltas: { totalDelta?: number; shardCountDeltas?: Record<string, number> } = {},
): Promise<{ path: string; content: string }> {
  const cur = await getRepoFileText(INDEX_PATH, token);
  if (!cur) throw new Error(`${INDEX_PATH} not found`);
  const obj = JSON.parse(cur.text) as DataIndex & {
    max_per_file?: number;
  };
  const newTotal = (obj.total ?? 0) + (deltas.totalDelta ?? 0);
  const newFiles = (obj.files ?? []).map((f) => ({
    name: f.name,
    count: f.count + (deltas.shardCountDeltas?.[f.name] ?? 0),
  }));
  const next = {
    max_per_file: obj.max_per_file ?? 800,
    total: newTotal,
    last_updated: nowIsoSeconds(),
    files: newFiles,
  };
  return { path: INDEX_PATH, content: JSON.stringify(next, null, 2) + "\n" };
}

export type CommitSigner = (commitContent: string) => Promise<string>;

export interface CommitAuthor {
  name: string;
  email: string;
}

export interface EditPatch {
  genre?: string;
  type_game?: "online" | "offline" | "";
  anti_cheat?: string;
  anti_cheat_note?: string;
  is_kernel_ac?: boolean | null;
  notes?: string;
  safe?: "y" | "n" | "?" | "";
  status?: "active" | "delisted";
}

export interface UpdateGameInput {
  record: GameRecord;
  patch: EditPatch;
  flatIndex: number;
  index: DataIndex;
  author: CommitAuthor;
  signer?: CommitSigner;
  token: string;
  triggerMarkdownRebuild?: boolean;
}

export interface EditResult {
  shard: string;
  commit: CommitResult;
}

function applyPatch(record: GameRecord, patch: EditPatch): GameRecord {
  const out = { ...record };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Edit one record in its shard. Refetches the latest shard content (via
 * Contents API) to merge against, then signs+commits via Git Data API.
 *
 * Throws RefAdvancedError on race; commitFileWithRetry already retries once.
 */
export async function updateGame(input: UpdateGameInput): Promise<EditResult> {
  const appid = extractAppid(input.record.link);
  if (!appid) throw new Error("Record has no appid");

  const shard = shardForFlatIndex(input.flatIndex, input.index);
  const shardPath = `${DATA_DIR}/${shard}`;

  const current = await getRepoFileText(shardPath, input.token);
  if (!current) throw new Error(`Shard not found: ${shardPath}`);

  const records = parseShardJsonl(current.text);
  const idx = findRecordIndexByAppid(records, appid);
  if (idx === -1) {
    throw new Error(
      `Record ${appid} not found in ${shard} (${records.length} rows in shard) — shard may have been re-balanced.`,
    );
  }
  records[idx] = applyPatch(records[idx], input.patch);
  const newText = serializeShardJsonl(records);

  const indexFile = await bumpedIndexFile(input.token);
  const commit = await commitFilesWithRetry({
    files: [{ path: shardPath, content: newText }, indexFile],
    message: `Edit ${input.record.name || appid} (${shard})`,
    author: input.author,
    signer: input.signer,
    token: input.token,
  });

  if (input.triggerMarkdownRebuild) {
    try {
      await dispatchWorkflow("update-daily.yml", input.token);
    } catch {
      /* non-fatal */
    }
  }

  return { shard, commit };
}

export { RefAdvancedError };

/* ──────────── Replace whole record (JSON editor) ──────────── */

export interface ReplaceGameInput {
  original: GameRecord;
  replacement: GameRecord;
  flatIndex: number;
  index: DataIndex;
  author: CommitAuthor;
  signer?: CommitSigner;
  token: string;
  triggerMarkdownRebuild?: boolean;
}

export async function replaceGame(input: ReplaceGameInput): Promise<EditResult> {
  const appid = extractAppid(input.original.link);
  const replacementAppid = extractAppid(input.replacement.link);
  if (!appid) throw new Error("Original record has no appid");
  if (replacementAppid !== appid) {
    throw new Error(
      "Replacement link's appid must match the original. Edit the right record or create a new one.",
    );
  }

  const shard = shardForFlatIndex(input.flatIndex, input.index);
  const shardPath = `${DATA_DIR}/${shard}`;
  const current = await getRepoFileText(shardPath, input.token);
  if (!current) throw new Error(`Shard not found: ${shardPath}`);

  const records = parseShardJsonl(current.text);
  const idx = findRecordIndexByAppid(records, appid);
  if (idx === -1)
    throw new Error(
      `Record ${appid} not in ${shard} (${records.length} rows in shard)`,
    );

  // Preserve added_at from the original — it's a "creation time" the user
  // shouldn't be able to retroactively rewrite via the JSON editor.
  records[idx] = {
    ...input.replacement,
    added_at: input.original.added_at || input.replacement.added_at,
  };

  const indexFile = await bumpedIndexFile(input.token);
  const commit = await commitFilesWithRetry({
    files: [
      { path: shardPath, content: serializeShardJsonl(records) },
      indexFile,
    ],
    message: `Replace ${input.replacement.name || appid} (${shard}) — full JSON edit`,
    author: input.author,
    signer: input.signer,
    token: input.token,
  });

  if (input.triggerMarkdownRebuild) {
    try {
      await dispatchWorkflow("update-daily.yml", input.token);
    } catch {
      /* non-fatal */
    }
  }

  return { shard, commit };
}

/* ──────────── Bulk edit (cross-shard, single commit) ──────────── */

export interface BulkEditInput {
  appids: string[];
  patch: EditPatch;
  appidIndex: Map<string, number>;
  index: DataIndex;
  author: CommitAuthor;
  signer?: CommitSigner;
  token: string;
  triggerMarkdownRebuild?: boolean;
}

export interface BulkEditResult {
  modified: number;
  shardsTouched: string[];
  commit: CommitResult;
}

/**
 * Apply the same patch to multiple records, possibly spanning multiple shards,
 * in a SINGLE git commit. Refetches each affected shard's current contents
 * (so concurrent daily-pipeline edits to non-selected records survive).
 */
export async function bulkEditGames(
  input: BulkEditInput,
): Promise<BulkEditResult> {
  // 1. Group target appids by shard.
  const byShard = new Map<string, string[]>();
  for (const appid of input.appids) {
    const flatIdx = input.appidIndex.get(appid);
    if (flatIdx === undefined) continue;
    const shard = shardForFlatIndex(flatIdx, input.index);
    const arr = byShard.get(shard) ?? [];
    arr.push(appid);
    byShard.set(shard, arr);
  }
  if (byShard.size === 0) {
    throw new Error("None of the selected records mapped to a shard.");
  }

  // 2. Fetch + mutate each affected shard in parallel.
  const files: { path: string; content: string }[] = [];
  let modified = 0;
  await Promise.all(
    Array.from(byShard.entries()).map(async ([shard, appids]) => {
      const path = `${DATA_DIR}/${shard}`;
      const current = await getRepoFileText(path, input.token);
      if (!current) throw new Error(`Shard ${shard} not found`);
      const records = parseShardJsonl(current.text);
      for (const appid of appids) {
        const idx = findRecordIndexByAppid(records, appid);
        if (idx === -1) continue;
        records[idx] = applyPatch(records[idx], input.patch);
        modified++;
      }
      files.push({ path, content: serializeShardJsonl(records) });
    }),
  );

  // Always bump index.json so cache consumers know data changed.
  files.push(await bumpedIndexFile(input.token));

  // 3. One signed commit covers all touched shards.
  const commit = await commitFilesWithRetry({
    files,
    message: `Bulk edit ${modified} game${modified === 1 ? "" : "s"} (${byShard.size} shard${byShard.size === 1 ? "" : "s"})`,
    author: input.author,
    signer: input.signer,
    token: input.token,
  });

  if (input.triggerMarkdownRebuild) {
    try {
      await dispatchWorkflow("update-daily.yml", input.token);
    } catch {
      /* non-fatal */
    }
  }

  return { modified, shardsTouched: files.map((f) => f.path), commit };
}

/* ──────────── Bulk delete (hard) ──────────── */

export interface BulkDeleteInput {
  appids: string[];
  appidIndex: Map<string, number>;
  index: DataIndex;
  author: CommitAuthor;
  signer?: CommitSigner;
  token: string;
}

export async function bulkDeleteGames(
  input: BulkDeleteInput,
): Promise<{ removed: number; commit: CommitResult }> {
  const targetSet = new Set(input.appids);
  if (targetSet.size === 0) throw new Error("No appids to delete.");

  // Group appids per affected shard via in-memory index.
  const shardsTouched = new Set<string>();
  for (const appid of targetSet) {
    const flatIdx = input.appidIndex.get(appid);
    if (flatIdx === undefined) continue;
    const shard = shardForFlatIndex(flatIdx, input.index);
    shardsTouched.add(shard);
  }
  if (shardsTouched.size === 0) {
    throw new Error("Selected records did not match any shard.");
  }

  // Refetch the entire `removed_games.jsonl` log so we can append.
  const removedLogPath = "scripts/removed_games.jsonl";
  const removedLog = await getRepoFileText(removedLogPath, input.token);
  const removedLogText = removedLog?.text ?? "";

  // Refetch + filter each affected shard.
  const files: { path: string; content: string }[] = [];
  let removed = 0;
  const removedRecords: GameRecord[] = [];
  const shardCountDeltas: Record<string, number> = {};

  await Promise.all(
    Array.from(shardsTouched).map(async (shard) => {
      const path = `${DATA_DIR}/${shard}`;
      const current = await getRepoFileText(path, input.token);
      if (!current) return;
      const records = parseShardJsonl(current.text);
      const kept: GameRecord[] = [];
      let removedHere = 0;
      for (const r of records) {
        const aid = extractAppid(r.link);
        if (aid && targetSet.has(aid)) {
          removed++;
          removedHere++;
          removedRecords.push(r);
        } else {
          kept.push(r);
        }
      }
      shardCountDeltas[shard] = -removedHere;
      files.push({ path, content: serializeShardJsonl(kept) });
    }),
  );

  // Append removed records to the log.
  const newLogLines = removedRecords.map((r) => JSON.stringify({ ...r, removed_at: new Date().toISOString() }));
  const mergedLog =
    (removedLogText.endsWith("\n") || removedLogText === ""
      ? removedLogText
      : removedLogText + "\n") + newLogLines.join("\n") + "\n";
  files.push({ path: removedLogPath, content: mergedLog });

  // Bump index.json with corrected total + per-shard counts.
  files.push(
    await bumpedIndexFile(input.token, {
      totalDelta: -removed,
      shardCountDeltas,
    }),
  );

  const commit = await commitFilesWithRetry({
    files,
    message: `Bulk delete ${removed} game${removed === 1 ? "" : "s"}`,
    author: input.author,
    signer: input.signer,
    token: input.token,
  });

  return { removed, commit };
}

/* ──────────── Add (queue to temp_info.jsonl) ──────────── */

/**
 * One entry destined for `scripts/temp_info.jsonl`. Pipeline's
 * `parse_entries` accepts a dict with `link` plus any MANUAL_FIELDS overrides
 * (genre / type_game / anti_cheat / anti_cheat_note / is_kernel_ac / notes /
 * safe). Manual values survive the daily refetch.
 */
export interface AddEntry {
  link: string;
  genre?: string;
  type_game?: "online" | "offline" | "";
  anti_cheat?: string;
  anti_cheat_note?: string;
  is_kernel_ac?: boolean | null;
  notes?: string;
  safe?: "y" | "n" | "?" | "";
}

export interface AddLinksInput {
  entries: AddEntry[];
  existingAppids: Set<string>;
  author: CommitAuthor;
  signer?: CommitSigner;
  token: string;
}

export interface AddLinksResult {
  added: AddEntry[];
  skipped: { link: string; reason: string }[];
  commit: CommitResult;
}

function pruneEmpty(e: AddEntry): AddEntry {
  const out: Record<string, unknown> = { link: e.link };
  for (const [k, v] of Object.entries(e)) {
    if (k === "link") continue;
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out as unknown as AddEntry;
}

export async function addLinks(input: AddLinksInput): Promise<AddLinksResult> {
  const added: AddEntry[] = [];
  const skipped: { link: string; reason: string }[] = [];
  const seenInBatch = new Set<string>();

  for (const raw of input.entries) {
    const trimmed = (raw.link ?? "").trim();
    if (!trimmed) continue;
    const normalized = normalizeLink(trimmed);
    if (!normalized) {
      skipped.push({ link: trimmed, reason: "not a valid Steam link" });
      continue;
    }
    const appid = extractAppid(normalized);
    if (!appid) {
      skipped.push({ link: trimmed, reason: "no appid" });
      continue;
    }
    if (input.existingAppids.has(appid)) {
      skipped.push({ link: trimmed, reason: "already in dataset" });
      continue;
    }
    if (seenInBatch.has(appid)) {
      skipped.push({ link: trimmed, reason: "duplicate in batch" });
      continue;
    }
    seenInBatch.add(appid);
    added.push(pruneEmpty({ ...raw, link: normalized }));
  }

  if (added.length === 0) {
    throw new Error("No new links to add. " + skipped.map((s) => s.reason).join(", "));
  }

  const current = await getRepoFileText(TEMP_JSONL, input.token);
  const existingText = current?.text ?? "";
  const existingLines = existingText.split("\n").filter((l) => l.trim());

  const queuedAppids = new Set<string>();
  for (const line of existingLines) {
    try {
      const obj = JSON.parse(line);
      const aid = extractAppid(obj.link);
      if (aid) queuedAppids.add(aid);
    } catch {
      /* skip */
    }
  }

  const trulyNew: AddEntry[] = [];
  for (const e of added) {
    const aid = extractAppid(e.link);
    if (aid && queuedAppids.has(aid)) {
      skipped.push({ link: e.link, reason: "already queued" });
    } else {
      trulyNew.push(e);
    }
  }
  if (trulyNew.length === 0) {
    throw new Error("All links are already queued.");
  }

  const newLines = trulyNew.map((e) => JSON.stringify(e));
  const merged = [...existingLines, ...newLines].join("\n") + "\n";

  const commit = await commitFileWithRetry({
    path: TEMP_JSONL,
    content: merged,
    message: `Queue ${trulyNew.length} game${trulyNew.length === 1 ? "" : "s"} for ingest`,
    author: input.author,
    signer: input.signer,
    token: input.token,
  });

  return { added: trulyNew, skipped, commit };
}
