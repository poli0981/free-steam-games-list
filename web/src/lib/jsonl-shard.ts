/**
 * JSONL shard helpers — locate a record's shard, mutate, re-serialize.
 */
import { extractAppid } from "./data-store";
import type { DataIndex, GameRecord } from "./schema";

/** Given a flat record index and the shard manifest, return the shard filename. */
export function shardForFlatIndex(
  flatIdx: number,
  index: DataIndex,
): string {
  let cum = 0;
  for (const f of index.files) {
    if (flatIdx < cum + f.count) return f.name;
    cum += f.count;
  }
  // Fallback: append to last shard.
  return index.files[index.files.length - 1]?.name ?? "data_001.jsonl";
}

/** Decode base64 (UTF-8) shard content from Contents API. */
export function decodeBase64Utf8(b64: string): string {
  const cleaned = b64.replace(/\s/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Parse JSONL text into GameRecord array (no migration; raw shape). */
export function parseShardJsonl(text: string): GameRecord[] {
  const out: GameRecord[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip bad lines */
    }
  }
  return out;
}

/** Serialize records → JSONL (one record per line, no trailing newline). */
export function serializeShardJsonl(records: GameRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/** Find the index of the record matching the given appid. -1 if not found. */
export function findRecordIndexByAppid(
  records: GameRecord[],
  appid: string,
): number {
  for (let i = 0; i < records.length; i++) {
    if (extractAppid(records[i].link) === appid) return i;
  }
  return -1;
}
