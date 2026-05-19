/**
 * useRemovedGames — fetch scripts/removed_games.jsonl, parse lines, dedup by appid.
 *
 * Mirrors `dedup_removed` in scripts/core/data_store.py: when an appid has
 * multiple rows, keep the one with the most-recent `removed_at`. Schema is
 * `{ link, name, appid, reason, status_code, removed_at }` with optional
 * extra fields (full game metadata on rows written by historic delete flows).
 */
import { useQuery } from "@tanstack/react-query";
import { rawUrl } from "../lib/fetcher";

export interface RemovedGame {
  link: string;
  name: string;
  appid?: string;
  reason: string;
  status_code: "not_free" | "unavailable" | string;
  removed_at: string;
  [extra: string]: unknown;
}

const APPID_RE = /\/app\/(\d+)/;

function extractAppid(link: string): string | null {
  const m = APPID_RE.exec(link);
  return m ? m[1] : null;
}

function parseJsonl(text: string): RemovedGame[] {
  const out: RemovedGame[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RemovedGame);
    } catch {
      // Skip malformed line
    }
  }
  return out;
}

function dedup(records: RemovedGame[]): RemovedGame[] {
  const latest = new Map<string, RemovedGame>();
  for (const r of records) {
    const aid = r.appid || extractAppid(r.link);
    if (!aid) continue;
    const prev = latest.get(aid);
    if (!prev || (r.removed_at ?? "") > (prev.removed_at ?? "")) {
      latest.set(aid, r);
    }
  }
  return [...latest.values()];
}

async function fetchRemoved(signal?: AbortSignal): Promise<RemovedGame[]> {
  const res = await fetch(rawUrl("scripts/removed_games.jsonl"), {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch removed_games.jsonl: ${res.status}`);
  }
  return dedup(parseJsonl(await res.text()));
}

export function useRemovedGames() {
  return useQuery({
    queryKey: ["removed-games"],
    queryFn: ({ signal }) => fetchRemoved(signal),
    staleTime: 5 * 60 * 1000,
  });
}
