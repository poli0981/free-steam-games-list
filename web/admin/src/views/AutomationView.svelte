<!--
  Auto-approve: the settings, what the next batch would be, and a button to run
  one batch now. The runner and every limit are worker/lib/auto-approve.ts;
  the rules are shared/automation.ts, so this form cannot offer what the server
  would refuse.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import Bot from "@lucide/svelte/icons/bot";
  import Play from "@lucide/svelte/icons/play";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Info from "@lucide/svelte/icons/info";
  import Button from "../../../src/lib/ui/Button.svelte";
  import Badge from "../../../src/lib/ui/Badge.svelte";
  import Dialog from "../components/Dialog.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { reportError } from "../lib/notify";
  import { router } from "../lib/router.svelte";
  import { commitUrl, exactTime, formatInt, relativeTime, shortSha } from "../lib/format";
  import {
    AUTO_ORDERS,
    AUTO_ORDER_LABEL,
    AUTO_MAX_AGE_HOURS,
    validateSettings,
    type AutoSettings,
  } from "../../../shared/automation";
  import type { AutomationResponse, AutoRunResponse } from "../../../shared/admin-api";

  let data = $state.raw<AutomationResponse | null>(null);
  let loadError = $state<string | null>(null);
  let form = $state<AutoSettings | null>(null);
  let saved = $state.raw<AutoSettings | null>(null);
  let customSource = $state("");
  let saving = $state(false);
  let running = $state(false);
  let runOpen = $state(false);

  async function load() {
    loadError = null;
    try {
      const res = await api<AutomationResponse>("automation");
      data = res;
      saved = res.settings;
      form = structuredClone(res.settings);
    } catch (err) {
      loadError = errorMessage(err);
      if (err instanceof SessionExpiredError) reportError(err);
    }
  }

  onMount(() => {
    void load();
    return router.guard(() => (dirty ? "Leave without saving the auto-approve settings?" : null));
  });

  const dirty = $derived(!!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved));
  const checked = $derived(form ? validateSettings($state.snapshot(form)) : null);
  const invalid = $derived(checked && !checked.ok ? checked.error : null);

  /** Exact sources in the queue, plus a prefix for each family ("backfill:*"). */
  const sourceOptions = $derived.by(() => {
    const exact = (data?.sources ?? []).map((s) => s.source);
    const prefixes = [...new Set(exact.filter((s) => s.includes(":")).map((s) => s.split(":")[0] + ":*"))];
    return [...new Set([...prefixes, ...exact, ...(form?.sources ?? [])])];
  });
  const pendingOf = (source: string) => {
    const rows = data?.sources ?? [];
    return source.endsWith("*")
      ? rows.filter((r) => r.source.startsWith(source.slice(0, -1))).reduce((n, r) => n + r.pending, 0)
      : (rows.find((r) => r.source === source)?.pending ?? 0);
  };

  function toggleSource(source: string, on: boolean) {
    if (!form) return;
    form.sources = on ? [...new Set([...form.sources, source])] : form.sources.filter((s) => s !== source);
  }

  function addCustom() {
    const s = customSource.trim();
    if (!s) return;
    toggleSource(s, true);
    customSource = "";
  }

  async function save() {
    if (!form || invalid) return;
    saving = true;
    try {
      await api("automation", { method: "POST", body: { settings: $state.snapshot(form) } });
      toast.success(form.enabled ? "Auto-approve is on" : "Settings saved", {
        description: form.enabled
          ? `Up to ${form.batchSize} per batch, ${form.dailyLimit} a day. The next cron tick (every 15 minutes) may start.`
          : "The schedule is off. Run one batch now still works.",
      });
      await load();
    } catch (err) {
      reportError(err, "Saving the settings failed");
    } finally {
      saving = false;
    }
  }

  async function runNow() {
    running = true;
    try {
      const out = await api<AutoRunResponse>("automation/run", { method: "POST" });
      if (out.outcome === "approved") {
        const sha = out.sha;
        toast.success(`Approved ${out.count ?? 0} game(s)`, {
          description: sha ? `Commit ${shortSha(sha)}. ingest_new.py runs next.` : out.detail,
          action: sha ? { label: "View commit", onClick: () => window.open(commitUrl(sha), "_blank", "noopener") } : undefined,
        });
      } else if (out.outcome === "skipped") {
        toast.info("Nothing approved", { description: out.detail });
      } else {
        toast.error("The batch failed", { description: out.detail });
      }
    } catch (err) {
      reportError(err, "Running a batch failed");
    } finally {
      running = false;
      runOpen = false;
      await load();
    }
  }

  const progress = $derived(data ? Math.min(100, Math.round((data.today.used / Math.max(data.today.limit, 1)) * 100)) : 0);
</script>

<section class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Auto-approve</h1>
      <p class="max-w-3xl text-sm text-muted-foreground">
        Every 15 minutes the cron can approve one batch of pending games for you - the same request a reviewer's Approve
        makes. ingest_new.py still checks each game (free, reachable, a game, not already listed) before anything is
        published.
      </p>
    </div>
    <Button variant="outline" size="sm" onclick={load}><RefreshCw class="size-4" /> Refresh</Button>
  </div>

  {#if loadError}
    <div class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
      <p>{loadError}</p>
    </div>
  {:else if !data || !form}
    <p class="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Loading…</p>
  {:else}
    {#if !data.stateAvailable}
      <div class="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
        D1 table admin_state is missing (migration 0002), so settings cannot be stored and nothing runs.
      </div>
    {/if}

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <!-- Status -->
      <article class="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 class="font-semibold">Status</h2>
        <div class="flex flex-wrap items-center gap-2 text-sm">
          {#if saved?.enabled}<Badge variant="success">schedule on</Badge>{:else}<Badge variant="secondary">schedule off</Badge>{/if}
          <span class="text-muted-foreground">{formatInt(data.eligible)} eligible now</span>
        </div>
        <div>
          <div class="flex justify-between text-xs text-muted-foreground">
            <span>Today ({data.today.date} UTC)</span>
            <span class="tnum">{formatInt(data.today.used)} / {formatInt(data.today.limit)}</span>
          </div>
          <div class="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div class="h-full bg-primary" style="width: {progress}%"></div>
          </div>
        </div>
        <p class="text-sm text-muted-foreground">{formatInt(data.inFlight)} row(s) approved and waiting for the pipeline.</p>
        {#if data.last}
          <p class="text-sm">
            Last {data.last.manual ? "manual " : ""}run
            <span title={exactTime(data.last.at)}>{relativeTime(data.last.at)}</span>:
            <span class={data.last.outcome === "failed" ? "text-destructive" : data.last.outcome === "approved" ? "text-success" : ""}>
              {data.last.outcome}
            </span>
            - {data.last.detail}
            {#if data.last.sha}
              (<a class="text-primary hover:underline" href={commitUrl(data.last.sha)} target="_blank" rel="noopener noreferrer">{shortSha(data.last.sha)}</a>)
            {/if}
          </p>
        {/if}
        <Button onclick={() => (runOpen = true)} disabled={running || !data.preview.length || !data.stateAvailable}>
          <Play class="size-4" /> Run one batch now
        </Button>
        <p class="text-xs text-muted-foreground">
          A batch waits while the previous one is still in scripts/temp_info.jsonl, or while a data job is running or
          waiting its turn - pushing then would cancel that job.
        </p>
      </article>

      <!-- Settings -->
      <form
        class="space-y-4 rounded-lg border border-border bg-card p-4 lg:col-span-2"
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 class="font-semibold">Settings</h2>
        <label class="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" class="size-4" bind:checked={form.enabled} />
          Run on the schedule (every 15 minutes)
        </label>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="space-y-1 text-sm">
            <span class="font-medium">Games per batch</span>
            <input type="number" min="1" max={data.maxBatch} step="1" bind:value={form.batchSize}
              class="h-9 w-full rounded-md border border-input bg-background px-3" />
            <span class="block text-xs text-muted-foreground">1-{data.maxBatch}; one batch at a time</span>
          </label>
          <label class="space-y-1 text-sm">
            <span class="font-medium">Games per day</span>
            <input type="number" min="1" max={data.ceiling} step="1" bind:value={form.dailyLimit}
              class="h-9 w-full rounded-md border border-input bg-background px-3" />
            <span class="block text-xs text-muted-foreground">1-{data.ceiling} (UTC day)</span>
          </label>
          <label class="space-y-1 text-sm">
            <span class="font-medium">Minimum wait (hours)</span>
            <input type="number" min="0" max={AUTO_MAX_AGE_HOURS} step="1" bind:value={form.minAgeHours}
              class="h-9 w-full rounded-md border border-input bg-background px-3" />
            <span class="block text-xs text-muted-foreground">time to reject by hand first</span>
          </label>
        </div>

        <label class="block space-y-1 text-sm">
          <span class="font-medium">Order</span>
          <select bind:value={form.order} class="h-9 w-full rounded-md border border-input bg-background px-3 sm:w-80">
            {#each AUTO_ORDERS as o (o)}<option value={o}>{AUTO_ORDER_LABEL[o]}</option>{/each}
          </select>
        </label>

        <fieldset class="space-y-2 text-sm">
          <legend class="font-medium">Sources</legend>
          <p class="text-xs text-muted-foreground">None ticked means every source. A name ending in * matches by prefix.</p>
          <div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {#each sourceOptions as s (s)}
              <label class="flex items-center gap-2">
                <input type="checkbox" class="size-4" checked={form.sources.includes(s)}
                  onchange={(e) => toggleSource(s, e.currentTarget.checked)} />
                <span class="font-mono text-xs">{s}</span>
                <span class="tnum text-xs text-muted-foreground">{formatInt(pendingOf(s))} pending</span>
              </label>
            {/each}
          </div>
          <div class="flex max-w-md gap-2">
            <input type="text" bind:value={customSource} placeholder="another source, e.g. discover" maxlength="41"
              class="h-8 flex-1 rounded-md border border-input bg-background px-3 text-xs" />
            <Button type="button" variant="outline" size="sm" onclick={addCustom} disabled={!customSource.trim()}>Add</Button>
          </div>
        </fieldset>

        {#if invalid}<p class="text-sm text-destructive">{invalid}</p>{/if}
        <div class="flex items-center gap-2">
          <Button type="submit" disabled={!dirty || !!invalid || saving || !data.stateAvailable}>
            {#if saving}<LoaderCircle class="size-4 animate-spin" />{/if} Save settings
          </Button>
          {#if dirty}
            <Button type="button" variant="ghost" onclick={() => (form = structuredClone($state.snapshot(saved)))}>Discard</Button>
          {/if}
        </div>
      </form>
    </div>

    <!-- Next batch -->
    <article class="space-y-2 rounded-lg border border-border bg-card p-4">
      <h2 class="font-semibold">Next batch ({data.preview.length})</h2>
      {#if data.preview.length}
        <div class="relative overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-muted-foreground">
              <tr><th class="py-1 pr-3 font-medium">Game</th><th class="py-1 pr-3 font-medium">Source</th><th class="py-1 font-medium">Waiting since</th></tr>
            </thead>
            <tbody>
              {#each data.preview as r (r.id)}
                <tr class="border-t border-border">
                  <td class="max-w-80 truncate py-1 pr-3">{r.name || "(no name)"} <span class="font-mono text-xs text-muted-foreground">{r.appid}</span></td>
                  <td class="py-1 pr-3 font-mono text-xs">{r.source}</td>
                  <td class="py-1 text-muted-foreground" title={exactTime(r.first_seen_at)}>{relativeTime(r.first_seen_at)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <EmptyState icon={Bot} title="Nothing eligible">
          No pending row matches the settings: free, a game, healthy, waited long enough, from an allowed source.
        </EmptyState>
      {/if}
    </article>

    <!-- History -->
    <article class="space-y-2 rounded-lg border border-border bg-card p-4">
      <h2 class="font-semibold">History</h2>
      {#if data.history.length}
        <ul class="divide-y divide-border text-sm">
          {#each data.history as h (h.id)}
            <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <span class="font-mono text-xs">{h.action}</span>
              <span class="text-muted-foreground" title={exactTime(h.created_at)}>{relativeTime(h.created_at)}</span>
              <span class="text-xs text-muted-foreground">{h.actor}</span>
            </li>
          {/each}
        </ul>
        <a class="inline-flex items-center gap-1 text-sm text-primary hover:underline" href="/admin/audit?action=auto.approve">
          <Info class="size-3.5" /> Everything in the audit log
        </a>
      {:else}
        <p class="text-sm text-muted-foreground">Nothing yet.</p>
      {/if}
    </article>
  {/if}
</section>

<Dialog
  bind:open={runOpen}
  title="Approve the next batch now?"
  description="The same request as the schedule's: one commit to scripts/temp_info.jsonl, within today's limit."
  size="lg"
  dismissable={!running}
>
  {#if data}
    <ul class="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm scrollbar-slim">
      {#each data.preview as r (r.id)}
        <li class="flex items-center justify-between gap-3 px-3 py-1.5">
          <span class="min-w-0 truncate">{r.name || "(no name)"}</span>
          <span class="shrink-0 font-mono text-xs text-muted-foreground">{r.appid}</span>
        </li>
      {/each}
    </ul>
    <p class="mt-3 text-sm text-muted-foreground">
      Runs even while the schedule is off. It still waits for an empty queue file and an idle pipeline.
    </p>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (runOpen = false)} disabled={running}>Cancel</Button>
    <Button onclick={runNow} disabled={running}>
      {#if running}<LoaderCircle class="size-4 animate-spin" />{:else}<Play class="size-4" />{/if}
      Approve {data?.preview.length ?? 0} game(s)
    </Button>
  {/snippet}
</Dialog>
