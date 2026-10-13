/**
 * /admin/api/pipeline: what the data workflows are doing - the latest runs of
 * each (shared/pipeline.ts), what is running or waiting in data-write, and how
 * much is queued in the files the pipeline consumes.
 *
 * GitHub trouble is a 502 with a JSON body, never a 401/403: the admin page
 * reads those two as "your Access session expired" and reloads.
 */
import { jsonError, SECURITY_HEADERS } from "../lib/http";
import type { AccessIdentity } from "../lib/access";
import { defaultAdminDeps, type AdminDeps } from "../lib/deps";
import { TEMP_INFO_PATH } from "../lib/git-commit";
import { recentRuns, type RunSummary } from "../lib/github-runs";
import { ADMIN_API_PREFIX } from "../../shared/admin-routes";
import { DATA_WORKFLOWS, isActiveRun } from "../../shared/pipeline";
import { BLOCKLIST_PATH } from "../../shared/removal";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

const lines = (text: string | null) => (text === null ? 0 : text.split("\n").filter((l) => l.trim()).length);

export async function handlePipelineApi(
  request: Request,
  url: URL,
  env: Env,
  _who: AccessIdentity,
  deps: AdminDeps = defaultAdminDeps,
): Promise<Response> {
  const route = url.pathname.slice(ADMIN_API_PREFIX.length);
  if (route !== "pipeline" || request.method !== "GET") return jsonError(404, "not found");

  let runs: RunSummary[];
  try {
    runs = await recentRuns(env, deps, { fresh: url.searchParams.get("fresh") === "1" });
  } catch (err) {
    return jsonError(502, err instanceof Error ? err.message : String(err));
  }

  // A weekly job can fall out of the last 100 runs; ask for those by file.
  const missing = DATA_WORKFLOWS.filter((w) => !runs.some((r) => r.file === w.file));
  const extra = await Promise.all(
    missing.map(async (w) => {
      try {
        const name = w.file.split("/").pop()!;
        const res = await deps.gh(env, `/repos/poli0981/free-steam-games-list/actions/workflows/${name}/runs?per_page=3`);
        if (!res.ok) return [];
        const body = (await res.json()) as { workflow_runs?: { path?: string }[] };
        return (body.workflow_runs ?? []).map((r) => ({ ...r, path: w.file }));
      } catch {
        return [];
      }
    }),
  );
  const extraRuns: RunSummary[] = extra.flat().map((r: Record<string, any>) => ({
    file: r.path,
    name: r.name ?? "",
    status: r.status ?? "",
    conclusion: r.conclusion ?? null,
    event: r.event ?? "",
    title: r.display_title ?? "",
    created_at: r.created_at ?? "",
    run_started_at: r.run_started_at ?? null,
    updated_at: r.updated_at ?? "",
    html_url: r.html_url ?? "",
    run_number: r.run_number ?? 0,
  }));
  const all = [...runs, ...extraRuns];

  let queue: { tempInfo: number | null; blocklist: number | null } = { tempInfo: null, blocklist: null };
  try {
    const { files } = await deps.readRepoFiles(env, [TEMP_INFO_PATH, BLOCKLIST_PATH]);
    queue = { tempInfo: lines(files[0]), blocklist: lines(files[1]) };
  } catch {
    /* shown as unknown */
  }

  return json({
    fetchedAt: deps.now().toISOString(),
    workflows: DATA_WORKFLOWS.map((w) => {
      const mine = all.filter((r) => r.file === w.file);
      return { ...w, latest: mine[0] ?? null, recent: mine.slice(0, 5) };
    }),
    active: all.filter((r) => DATA_WORKFLOWS.some((w) => w.file === r.file && w.dataWrite) && isActiveRun(r.status)),
    queue,
  });
}
