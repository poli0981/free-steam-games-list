/**
 * High-level edit/add operations: locate shard → fetch → mutate → PUT.
 * Triggers update-daily workflow after each commit so markdown stays in sync.
 */
import {
  getContents,
  putContents,
  dispatchWorkflow,
  ConflictError,
} from "./github-api";
import {
  shardForFlatIndex,
  decodeBase64Utf8,
  parseShardJsonl,
  serializeShardJsonl,
  findRecordIndexByAppid,
} from "./jsonl-shard";
import { extractAppid, normalizeLink } from "./data-store";
import { TEMP_JSONL, DATA_DIR, type DataIndex, type GameRecord } from "./schema";

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
  token: string;
  triggerMarkdownRebuild?: boolean;
}

export interface EditResult {
  shard: string;
  commitSha: string;
  htmlUrl: string;
}

/** Apply only non-undefined fields from a patch to a record. */
function applyPatch(record: GameRecord, patch: EditPatch): GameRecord {
  const out = { ...record };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Update one game record. Locates its shard, fetches latest content + sha,
 * applies the patch, and PUTs the new content back.
 *
 * Throws ConflictError if the shard's sha changed between fetch and PUT.
 */
export async function updateGame(input: UpdateGameInput): Promise<EditResult> {
  const appid = extractAppid(input.record.link);
  if (!appid) throw new Error("Record has no appid");

  const shard = shardForFlatIndex(input.flatIndex, input.index);
  const shardPath = `${DATA_DIR}/${shard}`;

  // 1. Fetch current shard
  const current = await getContents(shardPath, input.token);
  if (!current) throw new Error(`Shard not found: ${shardPath}`);

  // 2. Parse + locate
  const text = decodeBase64Utf8(current.content);
  const records = parseShardJsonl(text);
  const idx = findRecordIndexByAppid(records, appid);
  if (idx === -1) {
    throw new Error(
      `Record ${appid} not found in ${shard}. The shard may have been re-balanced.`,
    );
  }

  // 3. Apply patch
  records[idx] = applyPatch(records[idx], input.patch);
  const newText = serializeShardJsonl(records);

  // 4. PUT
  const result = await putContents({
    pathInRepo: shardPath,
    content: newText,
    message: `Edit ${input.record.name || appid} (${shard})`,
    sha: current.sha,
    token: input.token,
  });

  // 5. Optionally trigger markdown rebuild
  if (input.triggerMarkdownRebuild) {
    try {
      await dispatchWorkflow("update-daily.yml", input.token);
    } catch {
      /* non-fatal */
    }
  }

  return { shard, commitSha: result.commitSha, htmlUrl: result.htmlUrl };
}

/** Re-runs updateGame once on conflict (for transient races with the daily pipeline). */
export async function updateGameWithRetry(
  input: UpdateGameInput,
): Promise<EditResult> {
  try {
    return await updateGame(input);
  } catch (err) {
    if (err instanceof ConflictError) {
      // 1 retry — caller refetches data and re-applies if this also fails
      return await updateGame(input);
    }
    throw err;
  }
}

/* ──────────── Add (queue to temp_info.jsonl) ──────────── */

export interface AddLinksResult {
  added: string[];
  skipped: { link: string; reason: string }[];
  commitSha: string;
}

/**
 * Append links to scripts/temp_info.jsonl. Triggers the existing ingest-new
 * workflow which will fetch full Steam metadata.
 *
 * @param links — raw input lines (URLs or bare appids)
 * @param existingAppids — set of appids already in the dataset (for dedup)
 */
export async function addLinks(
  links: string[],
  existingAppids: Set<string>,
  token: string,
): Promise<AddLinksResult> {
  const added: string[] = [];
  const skipped: { link: string; reason: string }[] = [];
  const seenInBatch = new Set<string>();

  for (const raw of links) {
    const trimmed = raw.trim();
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
    if (existingAppids.has(appid)) {
      skipped.push({ link: trimmed, reason: "already in dataset" });
      continue;
    }
    if (seenInBatch.has(appid)) {
      skipped.push({ link: trimmed, reason: "duplicate in this batch" });
      continue;
    }
    seenInBatch.add(appid);
    added.push(normalized);
  }

  if (added.length === 0) {
    throw new Error("No new links to add. " + skipped.map((s) => s.reason).join(", "));
  }

  // Fetch existing temp_info.jsonl (may be empty)
  const current = await getContents(TEMP_JSONL, token);
  const existingText = current ? decodeBase64Utf8(current.content) : "";
  const existingLines = existingText.split("\n").filter((l) => l.trim());

  // Also dedup against existing temp queue
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

  const trulyNew: string[] = [];
  for (const link of added) {
    const aid = extractAppid(link);
    if (aid && queuedAppids.has(aid)) {
      skipped.push({ link, reason: "already queued" });
    } else {
      trulyNew.push(link);
    }
  }

  if (trulyNew.length === 0) {
    throw new Error("All links are already queued.");
  }

  const newLines = trulyNew.map((l) => JSON.stringify({ link: l }));
  const merged = [...existingLines, ...newLines].join("\n") + "\n";

  const result = await putContents({
    pathInRepo: TEMP_JSONL,
    content: merged,
    message: `Queue ${trulyNew.length} game${trulyNew.length === 1 ? "" : "s"} for ingest`,
    sha: current?.sha,
    token,
  });

  return { added: trulyNew, skipped, commitSha: result.commitSha };
}
