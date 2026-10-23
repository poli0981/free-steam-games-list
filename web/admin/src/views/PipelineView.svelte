<!--
  What the data workflows are doing, read from GitHub Actions by the Worker
  (worker/routes/pipeline.ts). Auto-approve waits for the same "nothing in
  data-write is running or waiting" this page shows.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Button from "../../../src/lib/ui/Button.svelte";
  import Badge, { type BadgeVariant } from "../../../src/lib/ui/Badge.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { reportError } from "../lib/notify";
  import { exactTime, relativeTime } from "../lib/format";
  import type { PipelineResponse, RunSummary } from "../../../shared/admin-api";

  let data = $state.raw<PipelineResponse | null>(null);
  let loadError = $state<string | null>(null);
  let loading = $state(false);

  async function load(fresh = false) {
    loading = true;
    loadError = null;
    try {
      data = await api<PipelineResponse>(fresh ? "pipeline?fresh=1" : "pipeline");
    } catch (err) {
      loadError = errorMessage(err);
      if (err instanceof SessionExpiredError) reportError(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  function runState(run: RunSummary): { text: string; variant: BadgeVariant } {
    if (run.status !== "completed") return { text: run.status.replace("_", " "), variant: run.status === "in_progress" ? "info" : "warning" };
    switch (run.conclusion) {
      case "success":
        return { text: "success", variant: "success" };
      case "failure":
      case "timed_out":
        return { text: run.conclusion.replace("_", " "), variant: "destructive" };
      case "cancelled":
        return { text: "cancelled", variant: "secondary" };
      default:
        return { text: run.conclusion ?? "done", variant: "outline" };
    }
  }

  function duration(run: RunSummary): string {
    const start = Date.parse(run.run_started_at ?? run.created_at);
    const end = run.status === "completed" ? Date.parse(run.updated_at) : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
    const minutes = Math.round((end - start) / 60_000);
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }
</script>

{#snippet badge(run: RunSummary)}
  {@const s = runState(run)}
  <Badge variant={s.variant}>{s.text}</Badge>
{/snippet}

<section class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Pipeline</h1>
      <p class="max-w-3xl text-sm text-muted-foreground">
        The data workflows on GitHub Actions. Those marked data-write take turns: one runs and the others wait in a queue,
        first in, first out.
      </p>
    </div>
    <Button variant="outline" size="sm" onclick={() => load(true)} disabled={loading}>
      <RefreshCw class="size-4 {loading ? 'animate-spin' : ''}" /> Refresh
    </Button>
  </div>

  {#if loadError}
    <div class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" /> <p>{loadError}</p>
    </div>
  {:else if !data}
    <p class="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Asking GitHub…</p>
  {:else}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-lg border border-border bg-card p-4 sm:col-span-2">
        <h2 class="mb-2 font-semibold">Running or waiting (data-write)</h2>
        {#if data.active.length}
          <ul class="space-y-1.5 text-sm">
            {#each data.active as r (r.html_url)}
              <li class="flex flex-wrap items-center gap-2">
                {@render badge(r)}
                <a class="hover:underline" href={r.html_url} target="_blank" rel="noopener noreferrer">{r.name}</a>
                <span class="text-muted-foreground" title={exactTime(r.run_started_at ?? r.created_at)}>
                  since {relativeTime(r.run_started_at ?? r.created_at)}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-muted-foreground">Nothing - the next data job (or auto-approve batch) can start straight away.</p>
        {/if}
      </div>
      <div class="rounded-lg border border-border bg-card p-4 text-sm">
        <h2 class="mb-2 font-semibold">Queued in Git</h2>
        <p>scripts/temp_info.jsonl: <span class="tnum font-medium">{data.queue.tempInfo ?? "?"}</span> link(s)</p>
        <p>data/blocklist.jsonl: <span class="tnum font-medium">{data.queue.blocklist ?? "?"}</span> line(s)</p>
        <p class="mt-2 text-xs text-muted-foreground" title={exactTime(data.fetchedAt)}>Read {relativeTime(data.fetchedAt)}</p>
      </div>
    </div>

    <div class="relative overflow-x-auto rounded-lg border border-border">
      <table class="w-full text-sm">
        <thead class="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th class="px-3 py-2 font-medium">Workflow</th>
            <th class="px-3 py-2 font-medium">Last run</th>
            <th class="hidden px-3 py-2 font-medium sm:table-cell">Started</th>
            <th class="hidden px-3 py-2 font-medium md:table-cell">Took</th>
            <th class="hidden px-3 py-2 font-medium md:table-cell">Recent</th>
          </tr>
        </thead>
        <tbody>
          {#each data.workflows as w (w.file)}
            <tr class="border-t border-border align-top">
              <td class="px-3 py-2">
                <p>{w.label}</p>
                <p class="font-mono text-xs text-muted-foreground">{w.file.split("/").pop()}{w.dataWrite ? " · data-write" : ""}</p>
              </td>
              <td class="px-3 py-2">
                {#if w.latest}
                  <a class="inline-flex items-center gap-1.5 hover:underline" href={w.latest.html_url} target="_blank" rel="noopener noreferrer">
                    {@render badge(w.latest)} <span class="text-xs text-muted-foreground">{w.latest.event}</span>
                    <ExternalLink class="size-3 text-muted-foreground" />
                  </a>
                {:else}
                  <span class="text-muted-foreground">no recent run</span>
                {/if}
              </td>
              <td class="hidden px-3 py-2 whitespace-nowrap text-muted-foreground sm:table-cell">
                {#if w.latest}<span title={exactTime(w.latest.run_started_at ?? w.latest.created_at)}>{relativeTime(w.latest.run_started_at ?? w.latest.created_at)}</span>{/if}
              </td>
              <td class="hidden px-3 py-2 whitespace-nowrap text-muted-foreground md:table-cell">{w.latest ? duration(w.latest) : ""}</td>
              <td class="hidden px-3 py-2 md:table-cell">
                <div class="flex gap-1">
                  {#each w.recent.slice(1) as r (r.html_url)}
                    {@const s = runState(r)}
                    <a href={r.html_url} target="_blank" rel="noopener noreferrer" title="{s.text}, {exactTime(r.created_at)}"
                      class="size-3 rounded-full {s.variant === 'success' ? 'bg-success' : s.variant === 'destructive' ? 'bg-destructive' : s.variant === 'info' || s.variant === 'warning' ? 'bg-warning' : 'bg-muted-foreground/40'}"
                      aria-label="{w.label}: {s.text}"></a>
                  {/each}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
