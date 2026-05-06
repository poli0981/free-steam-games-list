/**
 * GitHub raw data fetchers. Returns parsed records.
 * Uses raw.githubusercontent.com — sends ACAO:* so works directly from browser.
 */
import {
  REPO_OWNER,
  REPO_NAME,
  DEFAULT_BRANCH,
  DATA_DIR,
  type DataIndex,
  type GameRecord,
} from "./schema";
import { migrateRecord } from "./data-store";

const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${DEFAULT_BRANCH}`;

export function rawUrl(pathInRepo: string): string {
  return `${RAW_BASE}/${pathInRepo}`;
}

export async function fetchIndex(signal?: AbortSignal): Promise<DataIndex> {
  const res = await fetch(rawUrl(`${DATA_DIR}/index.json`), {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch index.json: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as DataIndex;
}

export async function fetchShardText(
  shardName: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(rawUrl(`${DATA_DIR}/${shardName}`), {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${shardName}: ${res.status}`);
  }
  return await res.text();
}

/** Parse JSONL text → records array (synchronous; called from worker). */
export function parseJsonl(text: string): GameRecord[] {
  const out: GameRecord[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      out.push(migrateRecord(obj));
    } catch (err) {
      console.warn(`[parseJsonl] line ${i + 1} skipped:`, err);
    }
  }
  return out;
}

export interface AllShardsResult {
  index: DataIndex;
  records: GameRecord[];
  shardOf: Map<string, string>; // appid → shard filename
}
