<!-- audit_log, newest first. Entries older than the retention window are pruned
     daily (worker/lib/prune.ts). -->
<script lang="ts">
  import { untrack } from "svelte";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Pager from "../components/Pager.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Button from "../../../src/lib/ui/Button.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { isAbort, reportError } from "../lib/notify";
  import { router } from "../lib/router.svelte";
  import { exactTime, prettyJson, relativeTime } from "../lib/format";
  import type { AuditEntry, Paged } from "../../../shared/admin-api";

  /** Every action the Worker records. A filter, not a validator: the server checks the shape. */
  const ACTIONS = [
    "approve",
    "approve.failed",
    "approve.desynced",
    "reject",
    "defer",
    "requeue",
    "reopen",
    "reconcile.manual",
    "reconcile.approved",
    "override",
    "override.failed",
    "override.delete",
    "override.delete.failed",
    "ingest.candidates",
    "admin.prune",
    "ping",
  ];
  const SIZES = [25, 50, 100, 200];

  const query = $derived(router.query);
  const action = $derived(query.get("action") ?? "");
  const actor = $derived(query.get("actor") ?? "");
  const size = $derived(SIZES.includes(Number(query.get("size"))) ? Number(query.get("size")) : 50);
  const page = $derived(Math.max(1, Math.floor(Number(query.get("page"))) || 1));

  let data = $state.raw<Paged<AuditEntry> | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let refresh = $state(0);
  let actorText = $state(untrack(() => actor));

  $effect(() => {
    const params = new URLSearchParams({ limit: String(size), offset: String((page - 1) * size) });
    if (action) params.set("action", action);
    if (actor) params.set("actor", actor);
    void refresh;
    const controller = new AbortController();
    untrack(() => {
      loading = true;
      loadError = null;
    });
    api<Paged<AuditEntry>>(`audit?${params}`, { signal: controller.signal })
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

  /** A one-line gist of the detail JSON, so most rows need no expanding. */
  function gist(detail: string): string {
    try {
      const d = JSON.parse(detail) as Record<string, unknown>;
      return Object.entries(d)
        .filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length))
        .slice(0, 5)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} item${v.length === 1 ? "" : "s"}` : typeof v === "object" ? "{…}" : String(v)}`)
        .join(" · ");
    } catch {
      return detail;
    }
  }
</script>

<section class="space-y-4">
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">Audit log</h1>
    <p class="text-sm text-muted-foreground">Who did what, newest first.</p>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <select
      aria-label="Filter by action"
      class="h-9 rounded-md border border-input bg-background px-2 text-sm"
      value={action}
      onchange={(e) => router.setQuery({ action: e.currentTarget.value || null, page: null })}
    >
      <option value="">Every action</option>
      {#each ACTIONS as a (a)}<option value={a}>{a}</option>{/each}
    </select>
    <form
      class="flex gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        router.setQuery({ actor: actorText.trim() || null, page: null });
      }}
    >
      <input
        bind:value={actorText}
        type="search"
        placeholder="Actor, exactly (you@example.com)"
        aria-label="Filter by actor"
        maxlength="200"
        class="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground"
      />
      <Button type="submit" variant="outline" size="sm" class="h-9">Filter</Button>
    </form>
    <Button variant="ghost" size="sm" onclick={() => refresh++} disabled={loading}>Refresh</Button>
  </div>

  {#if loadError}
    <p class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">{loadError}</p>
  {:else if data && !data.items.length}
    <div class="rounded-lg border border-border">
      <EmptyState icon={ScrollText} title={action || actor ? "No entries match these filters" : "Nothing recorded yet"} />
    </div>
  {:else if data}
    <div class="overflow-x-auto rounded-lg border border-border" class:opacity-60={loading}>
      <table class="w-full text-sm">
        <thead class="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th class="px-3 py-2.5">When</th>
            <th class="px-3 py-2.5">Actor</th>
            <th class="px-3 py-2.5">Action</th>
            <th class="px-3 py-2.5">Target</th>
            <th class="px-3 py-2.5">Detail</th>
          </tr>
        </thead>
        <tbody>
          {#each data.items as entry (entry.id)}
            <tr class="border-t border-border align-top">
              <td class="px-3 py-2 whitespace-nowrap" title={exactTime(entry.created_at)}>{relativeTime(entry.created_at)}</td>
              <td class="max-w-48 truncate px-3 py-2 text-xs" title={entry.actor}>
                <button
                  type="button"
                  class="hover:text-primary hover:underline"
                  title="Show only {entry.actor}"
                  onclick={() => {
                    actorText = entry.actor;
                    router.setQuery({ actor: entry.actor, page: null });
                  }}>{entry.actor}</button
                >
              </td>
              <td class="px-3 py-2 font-mono text-xs whitespace-nowrap">{entry.action}</td>
              <td class="max-w-40 truncate px-3 py-2 font-mono text-xs" title={entry.target ?? ""}>{entry.target ?? "—"}</td>
              <td class="min-w-64 px-3 py-2 text-xs">
                <details>
                  <summary class="cursor-pointer text-muted-foreground select-none hover:text-foreground">{gist(entry.detail_json)}</summary>
                  <pre class="mt-2 max-h-72 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap break-words">{prettyJson(
                      entry.detail_json,
                    )}</pre>
                </details>
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
