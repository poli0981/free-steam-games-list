/**
 * High-level edit/add operations using the Git Data API.
 *
 *   • Reads use the Contents API (cheap, returns sha for diagnostic only).
 *   • Writes use commitFileWithRetry → blob → tree → commit (signed if signer
 *     provided) → update ref. Signed commits get a "Verified" badge from GitHub.
 *   • After each successful edit commit, dispatches update-daily.yml so the
 *     markdown tables in games/ stay in sync with the data shards.
 */
import { getContents, dispatchWorkflow } from "./github-api";
import {
  commitFileWithRetry,
  RefAdvancedError,
  type CommitResult,
} from "./git-data";
import {
  shardForFlatIndex,
  decodeBase64Utf8,
  parseShardJsonl,
  serializeShardJsonl,
  findRecordIndexByAppid,
} from "./jsonl-shard";
import { extractAppid, normalizeLink } from "./data-store";
import { TEMP_JSONL, DATA_DIR, type DataIndex, type GameRecord } from "./schema";

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

  const current = await getContents(shardPath, input.token);
  if (!current) throw new Error(`Shard not found: ${shardPath}`);

  const text = decodeBase64Utf8(current.content);
  const records = parseShardJsonl(text);
  const idx = findRecordIndexByAppid(records, appid);
  if (idx === -1) {
    throw new Error(
      `Record ${appid} not found in ${shard} — shard may have been re-balanced.`,
    );
  }
  records[idx] = applyPatch(records[idx], input.patch);
  const newText = serializeShardJsonl(records);

  const commit = await commitFileWithRetry({
    path: shardPath,
    content: newText,
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

/* ──────────── Add (queue to temp_info.jsonl) ──────────── */

export interface AddLinksInput {
  links: string[];
  existingAppids: Set<string>;
  author: CommitAuthor;
  signer?: CommitSigner;
  token: string;
}

export interface AddLinksResult {
  added: string[];
  skipped: { link: string; reason: string }[];
  commit: CommitResult;
}

export async function addLinks(input: AddLinksInput): Promise<AddLinksResult> {
  const added: string[] = [];
  const skipped: { link: string; reason: string }[] = [];
  const seenInBatch = new Set<string>();

  for (const raw of input.links) {
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
    if (input.existingAppids.has(appid)) {
      skipped.push({ link: trimmed, reason: "already in dataset" });
      continue;
    }
    if (seenInBatch.has(appid)) {
      skipped.push({ link: trimmed, reason: "duplicate in batch" });
      continue;
    }
    seenInBatch.add(appid);
    added.push(normalized);
  }

  if (added.length === 0) {
    throw new Error("No new links to add. " + skipped.map((s) => s.reason).join(", "));
  }

  const current = await getContents(TEMP_JSONL, input.token);
  const existingText = current ? decodeBase64Utf8(current.content) : "";
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
