<!-- commit_jobs: every commit the Worker attempted, written before the attempt,
     so a commit that died mid-flight still leaves a row here. -->
<script lang="ts">
  import { untrack } from "svelte";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import StatusBadge from "../components/StatusBadge.svelte";
  import Pager from "../components/Pager.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Button from "../../../src/lib/ui/Button.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { isAbort, reportError } from "../lib/notify";
  import { router } from "../lib/router.svelte";
  import { commitUrl, exactTime, fileUrl, relativeTime, shortSha } from "../lib/format";
  import type { CommitJob, Paged } from "../../../shared/admin-api";

  const STATUSES = ["pending", "committed", "conflict", "failed"];
  const KINDS = ["approve", "override", "override.delete"];
  const SIZES = [25, 50, 100, 200];

  const query = $derived(router.query);
  const status = $derived(STATUSES.includes(query.get("status") ?? "") ? query.get("status")! : "");
  const kind = $derived(KINDS.includes(query.get("kind") ?? "") ? query.get("kind")! : "");
  const size = $derived(SIZES.includes(Number(query.get("size"))) ? Number(query.get("size")) : 50);
  const page = $derived(Math.max(1, Math.floor(Number(query.get("page"))) || 1));

  let data = $state.raw<Paged<CommitJob> | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let refresh = $state(0);

  $effect(() => {
    const params = new URLSearchParams({ limit: String(size), offset: String((page - 1) * size) });
    if (status) params.set("status", status);
    if (kind) params.set("kind", kind);
    void refresh;
    const controller = new AbortController();
    untrack(() => {
      loading = true;
      loadError = null;
    });
    api<Paged<CommitJob>>(`/api/admin/jobs?${params}`, { signal: controller.signal })
      .then((res) => {
        data = res;
        loading = false;
      })
      .catch((err) => {
        if (isAbort(err)) return;
        loading = false;
        loadError = errorMessage(err);
        if (err instanceof SessionExpiredError) reportError(err);
      });
    return () => controller.abort();
  });
</script>

<section class="space-y-4">
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">Commit jobs</h1>
    <p class="text-sm text-muted-foreground">
      Every commit the admin attempted. A job stuck in pending means the Worker stopped before it could record the result.
    </p>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <select
      aria-label="Filter by status"
      class="h-9 rounded-md border border-input bg-background px-2 text-sm"
      value={status}
      onchange={(e) => router.setQuery({ status: e.currentTarget.value || null, page: null })}
    >
      <option value="">Every status</option>
      {#each STATUSES as s (s)}<option value={s}>{s}</option>{/each}
    </select>
    <select
      aria-label="Filter by kind"
      class="h-9 rounded-md border border-input bg-background px-2 text-sm"
      value={kind}
      onchange={(e) => router.setQuery({ kind: e.currentTarget.value || null, page: null })}
    >
      <option value="">Every kind</option>
      {#each KINDS as k (k)}<option value={k}>{k}</option>{/each}
    </select>
    <Button variant="ghost" size="sm" onclick={() => refresh++} disabled={loading}>Refresh</Button>
  </div>

  {#if loadError}
    <p class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">{loadError}</p>
  {:else if data && !data.items.length}
    <div class="rounded-lg border border-border">
      <EmptyState icon={GitCommitHorizontal} title={status || kind ? "No jobs match these filters" : "No commits yet"} />
    </div>
  {:else if data}
    <div class="overflow-x-auto rounded-lg border border-border" class:opacity-60={loading}>
      <table class="w-full text-sm">
        <thead class="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th class="px-3 py-2.5">Started</th>
            <th class="px-3 py-2.5">Kind</th>
            <th class="px-3 py-2.5">Status</th>
            <th class="px-3 py-2.5">Target</th>
            <th class="px-3 py-2.5">Commit</th>
            <th class="px-3 py-2.5">By</th>
            <th class="px-3 py-2.5">Result</th>
          </tr>
        </thead>
        <tbody>
          {#each data.items as job (job.id)}
            <tr class="border-t border-border align-top">
              <td class="px-3 py-2 whitespace-nowrap" title={exactTime(job.created_at)}>{relativeTime(job.created_at)}</td>
              <td class="px-3 py-2 font-mono text-xs whitespace-nowrap">{job.kind}</td>
              <td class="px-3 py-2"><StatusBadge status={job.status} kind="job" /></td>
              <td class="max-w-64 truncate px-3 py-2 font-mono text-xs whitespace-nowrap" title={job.target_path}>
                {#if /^[\w./-]+$/.test(job.target_path)}
                  <a class="hover:text-primary hover:underline" href={fileUrl(job.target_path)} target="_blank" rel="noopener noreferrer">
                    {job.target_path}
                  </a>
                {:else}
                  {job.target_path}
                {/if}
              </td>
              <td class="px-3 py-2 whitespace-nowrap">
                {#if job.commit_sha}
                  <a
                    class="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                    href={commitUrl(job.commit_sha)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {shortSha(job.commit_sha)} <ExternalLink class="size-3" />
                  </a>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </td>
              <td class="max-w-48 truncate px-3 py-2 text-xs" title={job.requested_by ?? ""}>{job.requested_by ?? "—"}</td>
              <td class="max-w-80 px-3 py-2 text-xs">
                {#if job.error}
                  <p class="line-clamp-3 break-words {job.status === 'committed' ? 'text-muted-foreground' : 'text-destructive'}" title={job.error}>
                    {job.error}
                  </p>
                {:else if job.finished_at}
                  <span class="text-muted-foreground" title={exactTime(job.finished_at)}>finished {relativeTime(job.finished_at)}</span>
                {:else}
                  <span class="text-warning">not finished</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pager
      offset={data.offset}
      limit={data.limit}
      total={data.total}
      count={data.items.length}
      disabled={loading}
      sizes={SIZES}
      onpage={(o) => router.setQuery({ page: o / size + 1 === 1 ? null : o / size + 1 })}
      onsize={(n) => router.setQuery({ size: n === 50 ? null : n, page: null })}
    />
  {:else}
    <div class="h-40 animate-pulse rounded-lg bg-muted" aria-busy="true"></div>
  {/if}
</section>
