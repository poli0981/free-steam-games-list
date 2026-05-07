/**
 * After a successful commit, the latest data is already in our hands —
 * we just serialised it and pushed it to GitHub. The hard part is that
 * raw.githubusercontent.com is fronted by Fastly with `Cache-Control:
 * max-age=300`, so a refetch immediately after the commit will see the
 * pre-edit shard for up to 5 minutes. That's why edits "didn't seem to
 * stick" until the user happened to wait long enough (or hit a fresh
 * browser context like an incognito window).
 *
 * Solution: optimistically write our known-fresh data into both caches:
 *   1. TanStack Query — so the active table re-renders instantly.
 *   2. IndexedDB     — so a reload still sees fresh data.
 * Then the CDN catch-up happens in the background. The next natural
 * refetch (5-minute staleTime, or pulling Refresh in the dashboard)
 * sees the same data and is a no-op.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { GamesData } from "../hooks/useGames";
import { writeCache } from "./cache";
import { buildIndex, extractAppid } from "./data-store";
import type { EditPatch } from "./edits";
import type { GameRecord } from "./schema";

const QUERY_KEY = ["games", "all"] as const;

function nowIsoSeconds(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function applyPatchTo(record: GameRecord, patch: EditPatch): GameRecord {
  const out = { ...record };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

function commit(qc: QueryClient, mutate: (records: GameRecord[]) => GameRecord[]) {
  const data = qc.getQueryData<GamesData>(QUERY_KEY as unknown as string[]);
  if (!data) return;
  const records = mutate(data.records);
  const next: GamesData = {
    records,
    index: {
      ...data.index,
      total: records.length,
      last_updated: nowIsoSeconds(),
    },
    appidIndex: buildIndex(records),
  };
  qc.setQueryData<GamesData>(QUERY_KEY as unknown as string[], next);
  void writeCache({ records: next.records, index: next.index });
}

/** Apply a patch to a single record in-place (matched by flatIndex). */
export function optimisticEdit(
  qc: QueryClient,
  flatIndex: number,
  patch: EditPatch,
): void {
  commit(qc, (records) => {
    if (flatIndex < 0 || flatIndex >= records.length) return records;
    const next = records.slice();
    next[flatIndex] = applyPatchTo(next[flatIndex], patch);
    return next;
  });
}

/** Replace one record entirely (JSON-mode edit). */
export function optimisticReplace(
  qc: QueryClient,
  flatIndex: number,
  replacement: GameRecord,
): void {
  commit(qc, (records) => {
    if (flatIndex < 0 || flatIndex >= records.length) return records;
    const next = records.slice();
    next[flatIndex] = replacement;
    return next;
  });
}

/** Apply the same patch to every record matching one of these appids. */
export function optimisticBulkEdit(
  qc: QueryClient,
  appids: Iterable<string>,
  patch: EditPatch,
): void {
  const set = new Set(appids);
  commit(qc, (records) =>
    records.map((r) => {
      const aid = extractAppid(r.link);
      if (aid && set.has(aid)) return applyPatchTo(r, patch);
      return r;
    }),
  );
}

/** Drop records whose appid is in the set. */
export function optimisticBulkDelete(
  qc: QueryClient,
  appids: Iterable<string>,
): void {
  const set = new Set(appids);
  commit(qc, (records) =>
    records.filter((r) => {
      const aid = extractAppid(r.link);
      return !(aid && set.has(aid));
    }),
  );
}
