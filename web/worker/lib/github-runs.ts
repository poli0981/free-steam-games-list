/**
 * Recent GitHub Actions runs of this repository, for /admin/pipeline and for
 * auto-approve's "is the data pipeline idle?" gate.
 *
 * Read with the GitHub App token (5,000 requests an hour). The repository is
 * public, so the endpoint needs no Actions permission; if GitHub still says no
 * (403/404), the same request is tried anonymously - a Worker's shared IPs make
 * that budget small, which is why it is only the fallback.
 *
 * Memoized for a minute per isolate: the page polls nothing, but a cron tick
 * and a page load in the same minute need not both ask.
 */
import type { AdminDeps } from "./deps";
import { DATA_WORKFLOWS, isActiveRun } from "../../shared/pipeline";

const RUNS_PATH = "/repos/poli0981/free-steam-games-list/actions/runs?per_page=100&exclude_pull_requests=true";
const MEMO_MS = 60_000;

export interface RunSummary {
  /** The workflow file, e.g. ".github/workflows/ingest-new.yml". */
  file: string;
  name: string;
  status: string;
  conclusion: string | null;
  event: string;
  title: string;
  created_at: string;
  run_started_at: string | null;
  updated_at: string;
  html_url: string;
  run_number: number;
}

interface ApiRun {
  path?: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  event?: string;
  display_title?: string;
  created_at?: string;
  run_started_at?: string | null;
  updated_at?: string;
  html_url?: string;
  run_number?: number;
}

let memo: { gh: unknown; at: number; runs: RunSummary[] } | null = null;

function summarise(run: ApiRun): RunSummary {
  return {
    file: (run.path ?? "").split("@")[0],
    name: run.name ?? "",
    status: run.status ?? "",
    conclusion: run.conclusion ?? null,
    event: run.event ?? "",
    title: run.display_title ?? "",
    created_at: run.created_at ?? "",
    run_started_at: run.run_started_at ?? null,
    updated_at: run.updated_at ?? "",
    html_url: run.html_url ?? "",
    run_number: run.run_number ?? 0,
  };
}

/** Throws when GitHub cannot be read; callers decide what that means. */
export async function recentRuns(
  env: Env,
  deps: Pick<AdminDeps, "gh" | "now">,
  opts: { fresh?: boolean } = {},
): Promise<RunSummary[]> {
  const now = deps.now().getTime();
  if (!opts.fresh && memo && memo.gh === deps.gh && now - memo.at < MEMO_MS) return memo.runs;

  let res = await deps.gh(env, RUNS_PATH);
  if (res.status === 403 || res.status === 404) {
    res = await fetch(`https://api.github.com${RUNS_PATH}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "f2p-tracker-worker" },
    });
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the workflow runs`);
  const body = (await res.json()) as { workflow_runs?: ApiRun[] };
  const runs = (body.workflow_runs ?? []).map(summarise);
  memo = { gh: deps.gh, at: now, runs };
  return runs;
}

/** The data-write run that is running or waiting, if any. */
export function activeDataWrite(runs: RunSummary[]): RunSummary | null {
  const files = new Set(DATA_WORKFLOWS.filter((w) => w.dataWrite).map((w) => w.file));
  return runs.find((r) => files.has(r.file) && isActiveRun(r.status)) ?? null;
}
