<!--
  The admin's first page: one card per moving part, each loaded on its own so
  one failing endpoint blanks one card, not the page.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Inbox from "@lucide/svelte/icons/inbox";
  import Bot from "@lucide/svelte/icons/bot";
  import ArchiveX from "@lucide/svelte/icons/archive-x";
  import Workflow from "@lucide/svelte/icons/workflow";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Button from "../../../src/lib/ui/Button.svelte";
  import Badge from "../../../src/lib/ui/Badge.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { reportError } from "../lib/notify";
  import { exactTime, formatInt, relativeTime } from "../lib/format";
  import { QUEUE_STATUSES } from "../../../shared/queue-rules";
  import { QUALITY_CHECKS } from "../../../shared/quality";
  import type {
    AutomationResponse,
    PipelineResponse,
    QualitySummaryResponse,
    RemovedSummary,
    StatsResponse,
  } from "../../../shared/admin-api";

  type Slot<T> = { data: T | null; error: string | null; loading: boolean };
  const slot = <T,>(): Slot<T> => ({ data: null, error: null, loading: true });

  let stats = $state<Slot<StatsResponse>>(slot());
  let auto = $state<Slot<AutomationResponse>>(slot());
  let removed = $state<Slot<RemovedSummary>>(slot());
  let pipeline = $state<Slot<PipelineResponse>>(slot());
  let quality = $state<Slot<QualitySummaryResponse>>(slot());
  let busy = $state(false);

  async function fill<T>(target: Slot<T>, route: string): Promise<void> {
    target.loading = true;
    target.error = null;
    try {
      target.data = await api<T>(route);
    } catch (err) {
      target.error = errorMessage(err);
      if (err instanceof SessionExpiredError) reportError(err);
    } finally {
      target.loading = false;
    }
  }

  async function load() {
    busy = true;
    await Promise.all([
      fill(stats, "stats"),
      fill(auto, "automation"),
      fill(removed, "removed?summary=1"),
      fill(pipeline, "pipeline"),
      fill(quality, "quality"),
    ]);
    busy = false;
  }

  onMount(() => {
    void load();
  });

  const backlog = $derived((auto.data?.sources ?? []).filter((s) => s.pending > 0 || s.failed > 0));
  const jobAlerts = $derived.by(() => {
    const c = stats.data?.commits ?? {};
    return (["failed", "conflict", "pending"] as const).filter((s) => (c[s] ?? 0) > 0).map((s) => ({ status: s, n: c[s] }));
  });
  const progress = $derived(
    auto.data ? Math.min(100, Math.round((auto.data.today.used / Math.max(auto.data.today.limit, 1)) * 100)) : 0,
  );
  const ingest = $derived(pipeline.data?.workflows.find((w) => w.file.endsWith("ingest-new.yml")) ?? null);
  const qualityRows = $derived(
    quality.data
      ? QUALITY_CHECKS.filter((c) => c.group !== "info" && (quality.data!.counts[c.key] ?? 0) > 0).slice(0, 6)
      : [],
  );
</script>

{#snippet failed(message: string)}
  <p class="flex items-start gap-2 text-sm text-destructive"><TriangleAlert class="mt-0.5 size-4 shrink-0" /> {message}</p>
{/snippet}

{#snippet loading()}
  <p class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Loading…</p>
{/snippet}

<section class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Overview</h1>
      <p class="text-sm text-muted-foreground">What is waiting, what is running, and what needs a look.</p>
    </div>
    <Button variant="outline" size="sm" onclick={load} disabled={busy}>
      <RefreshCw class="size-4 {busy ? 'animate-spin' : ''}" /> Refresh
    </Button>
  </div>

  {#if jobAlerts.length}
    <div class="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
      <TriangleAlert class="size-4 text-warning" />
      {#each jobAlerts as a (a.status)}
        <a href="/admin/jobs?status={a.status}" class="hover:underline">{a.n} commit job{a.n === 1 ? "" : "s"} {a.status}</a>
      {/each}
    </div>
  {/if}

  <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <!-- Queue -->
    <article class="space-y-3 rounded-lg border border-border bg-card p-4">
      <header class="flex items-center justify-between gap-2">
        <h2 class="flex items-center gap-2 font-semibold"><Inbox class="size-4" /> Review queue</h2>
        <a class="text-sm text-primary hover:underline" href="/admin/queue">Open</a>
      </header>
      {#if stats.error}{@render failed(stats.error)}{:else if !stats.data}{@render loading()}{:else}
        <div class="flex flex-wrap gap-2">
          {#each QUEUE_STATUSES as s (s)}
            <a href={s === "pending" ? "/admin/queue" : `/admin/queue?status=${s}`} class="inline-flex items-center gap-1.5 hover:underline">
              <StatusBadge status={s} /> <span class="tnum text-sm">{formatInt(stats.data.queue[s] ?? 0)}</span>
            </a>
          {/each}
        </div>
      {/if}
      {#if backlog.length}
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-muted-foreground">
            <tr><th class="py-1 font-medium">Source</th><th class="py-1 text-right font-medium">Pending</th><th class="py-1 text-right font-medium">Failed</th></tr>
          </thead>
          <tbody>
            {#each backlog as s (s.source)}
              <tr class="border-t border-border">
                <td class="py-1 font-mono text-xs">{s.source}</td>
                <td class="tnum py-1 text-right">{formatInt(s.pending)}</td>
                <td class="tnum py-1 text-right {s.failed ? 'text-warning' : 'text-muted-foreground'}">{formatInt(s.failed)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </article>

    <!-- Auto-approve -->
    <article class="space-y-3 rounded-lg border border-border bg-card p-4">
      <header class="flex items-center justify-between gap-2">
        <h2 class="flex items-center gap-2 font-semibold"><Bot class="size-4" /> Auto-approve</h2>
        <a class="text-sm text-primary hover:underline" href="/admin/automation">Settings</a>
      </header>
      {#if auto.error}{@render failed(auto.error)}{:else if !auto.data}{@render loading()}{:else}
        <div class="flex flex-wrap items-center gap-2 text-sm">
          {#if auto.data.settings.enabled}<Badge variant="success">on</Badge>{:else}<Badge variant="secondary">off</Badge>{/if}
          <span class="text-muted-foreground">{formatInt(auto.data.eligible)} eligible now</span>
        </div>
        <div>
          <div class="flex justify-between text-xs text-muted-foreground">
            <span>Today ({auto.data.today.date} UTC)</span>
            <span class="tnum">{formatInt(auto.data.today.used)} / {formatInt(auto.data.today.limit)}</span>
          </div>
          <div class="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div class="h-full bg-primary" style="width: {progress}%"></div>
          </div>
        </div>
        {#if auto.data.last}
          <p class="text-sm">
            Last run <span title={exactTime(auto.data.last.at)}>{relativeTime(auto.data.last.at)}</span>:
            <span class={auto.data.last.outcome === "failed" ? "text-destructive" : ""}>{auto.data.last.outcome}</span>
            <span class="text-muted-foreground">- {auto.data.last.detail}</span>
          </p>
        {:else}
          <p class="text-sm text-muted-foreground">Has not run yet.</p>
        {/if}
      {/if}
    </article>

    <!-- Removals -->
    <article class="space-y-3 rounded-lg border border-border bg-card p-4">
      <header class="flex items-center justify-between gap-2">
        <h2 class="flex items-center gap-2 font-semibold"><ArchiveX class="size-4" /> Removed games</h2>
        <a class="text-sm text-primary hover:underline" href="/admin/remove?tab=removed">Open</a>
      </header>
      {#if removed.error}{@render failed(removed.error)}{:else if !removed.data}{@render loading()}{:else}
        <p class="text-sm">
          <span class="tnum font-medium">{formatInt(removed.data.total)}</span> blocked
          {#if removed.data.pending}
            · <span class="text-warning">{formatInt(removed.data.pending)} still in data/, waiting for the pipeline</span>
          {:else if removed.data.pending === null}
            · <span class="text-muted-foreground">catalogue unreadable just now</span>
          {/if}
        </p>
      {/if}
    </article>

    <!-- Pipeline -->
    <article class="space-y-3 rounded-lg border border-border bg-card p-4">
      <header class="flex items-center justify-between gap-2">
        <h2 class="flex items-center gap-2 font-semibold"><Workflow class="size-4" /> Pipeline</h2>
        <a class="text-sm text-primary hover:underline" href="/admin/pipeline">Open</a>
      </header>
      {#if pipeline.error}{@render failed(pipeline.error)}{:else if !pipeline.data}{@render loading()}{:else}
        {#if pipeline.data.active.length}
          <ul class="space-y-1 text-sm">
            {#each pipeline.data.active as r (r.html_url)}
              <li><Badge variant="info">{r.status}</Badge> <a class="hover:underline" href={r.html_url} target="_blank" rel="noopener noreferrer">{r.name}</a></li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-muted-foreground">No data job is running or waiting.</p>
        {/if}
        <p class="text-sm text-muted-foreground">
          Queue file: {pipeline.data.queue.tempInfo ?? "?"} link(s) · blocklist: {pipeline.data.queue.blocklist ?? "?"} line(s)
          {#if ingest?.latest}· last ingest {relativeTime(ingest.latest.created_at)} ({ingest.latest.conclusion ?? ingest.latest.status}){/if}
        </p>
      {/if}
    </article>

    <!-- Quality -->
    <article class="space-y-3 rounded-lg border border-border bg-card p-4 lg:col-span-2">
      <header class="flex items-center justify-between gap-2">
        <h2 class="flex items-center gap-2 font-semibold"><ListChecks class="size-4" /> Data quality</h2>
        <a class="text-sm text-primary hover:underline" href="/admin/quality">Open</a>
      </header>
      {#if quality.error}{@render failed(quality.error)}{:else if !quality.data}{@render loading()}{:else}
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each qualityRows as c (c.key)}
            <a href="/admin/quality?check={c.key}" class="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
              <span class="min-w-0 truncate">{c.label}</span>
              <span class="tnum shrink-0 font-medium">{formatInt(quality.data.counts[c.key])}</span>
            </a>
          {:else}
            <p class="text-sm text-muted-foreground">Nothing to report across {formatInt(quality.data.total)} games.</p>
          {/each}
        </div>
      {/if}
    </article>
  </div>
</section>
