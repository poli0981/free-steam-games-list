<!--
  The review queue.

  The rule this screen exists to enforce: a row that is already decided
  (approved, committed, rejected) or whose GAME is already published has no
  checkbox. It shows a lock instead, "select all" skips it, and the server
  refuses it anyway (shared/queue-rules.ts is the one definition both sides
  use).
-->
<script lang="ts">
  import { tick, untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { toast } from "svelte-sonner";
  import Search from "@lucide/svelte/icons/search";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Lock from "@lucide/svelte/icons/lock";
  import Inbox from "@lucide/svelte/icons/inbox";
  import Eye from "@lucide/svelte/icons/eye";
  import Keyboard from "@lucide/svelte/icons/keyboard";
  import Check from "@lucide/svelte/icons/check";
  import X from "@lucide/svelte/icons/x";
  import Clock from "@lucide/svelte/icons/clock";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Button from "../../../src/lib/ui/Button.svelte";
  import Badge from "../../../src/lib/ui/Badge.svelte";
  import Dialog from "../components/Dialog.svelte";
  import Thumb from "../components/Thumb.svelte";
  import Pager from "../components/Pager.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  import Kbd from "../components/Kbd.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import CandidateDialog from "./CandidateDialog.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { isAbort, reportError } from "../lib/notify";
  import { router } from "../lib/router.svelte";
  import { pageSelection, toggleAll } from "../lib/selection";
  import { QUEUE_SHORTCUTS, shouldIgnore } from "../lib/shortcuts";
  import { commitUrl, exactTime, plural, relativeTime, shortSha, steamUrl } from "../lib/format";
  import { ACTION_CONSEQUENCE, ACTION_LABEL, ACTION_PAST, LOCK_HELP, SKIP_TEXT, SORTS, STATUS_HELP } from "../lib/labels";
  import {
    MAX_DECIDE,
    QUEUE_STATUSES,
    allowedActions,
    lockReason,
    type DecideAction,
    type QueueStatus,
    type SkippedRow,
  } from "../../../shared/queue-rules";
  import type { DecideResponse, QueueItem, QueueResponse, ReconcileResponse, StatsResponse } from "../../../shared/admin-api";

  const TABS: QueueStatus[] = ["pending", "deferred", "failed", "approved", "committed", "rejected"];
  const SIZES = [25, 50, 100, 200];
  const EMPTY: Record<QueueStatus, string> = {
    pending: "Nothing is waiting for review.",
    deferred: "Nothing has been put aside.",
    failed: "No failed rows.",
    approved: "Nothing is waiting for the pipeline.",
    committed: "No published rows yet.",
    rejected: "Nothing has been rejected.",
  };

  // ── URL state: tab, search, sort and page survive a reload or a shared link ──
  const query = $derived(router.query);
  const q = $derived((query.get("q") ?? "").trim());
  const status = $derived.by((): QueueStatus | "all" => {
    const s = query.get("status") ?? "pending";
    if (s === "all") return q ? "all" : "pending";
    return (QUEUE_STATUSES as readonly string[]).includes(s) ? (s as QueueStatus) : "pending";
  });
  const sort = $derived(SORTS.find((s) => s.value === query.get("sort"))?.value ?? "newest");
  const size = $derived(SIZES.includes(Number(query.get("size"))) ? Number(query.get("size")) : 50);
  const page = $derived(Math.max(1, Math.floor(Number(query.get("page"))) || 1));
  const offset = $derived((page - 1) * size);
  const key = $derived(`${status}|${q}|${sort}|${size}|${offset}`);

  // ── data ──
  let data = $state.raw<QueueResponse | null>(null);
  let dataKey = "";
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let stats = $state.raw<StatsResponse | null>(null);
  let refresh = $state(0);

  const selected = new SvelteSet<string>();
  let cursor = $state(-1);
  let busy = $state(false);
  let reconciling = $state(false);

  $effect(() => {
    const k = key;
    void refresh;
    const params = new URLSearchParams({ status, sort, limit: String(size), offset: String(offset) });
    if (q) params.set("q", q);
    const controller = new AbortController();

    untrack(() => {
      loading = true;
      loadError = null;
      // A different listing never shows the previous one's rows, even
      // briefly: a stale row that can still be clicked is how a selection
      // used to pick up a row from the tab being left.
      if (dataKey !== k) {
        data = null;
        cursor = -1;
      }
      selected.clear();
    });

    api<QueueResponse>(`/api/admin/queue?${params}`, { signal: controller.signal })
      .then((res) => {
        data = res;
        dataKey = k;
        loading = false;
        if (cursor >= res.items.length) cursor = res.items.length - 1;
        // Deciding the last rows of the last page leaves an empty page behind.
        if (!res.items.length && res.total > 0 && res.offset > 0) {
          router.setQuery({ page: Math.ceil(res.total / size) });
        }
      })
      .catch((err) => {
        if (isAbort(err)) return;
        loading = false;
        loadError = errorMessage(err);
        if (err instanceof SessionExpiredError) reportError(err);
      });
    return () => controller.abort();
  });

  $effect(() => {
    void refresh;
    const controller = new AbortController();
    api<StatsResponse>("/api/admin/stats", { signal: controller.signal })
      .then((s) => (stats = s))
      .catch((err) => {
        // The tabs render without counts; only a lapsed session is worth saying.
        if (err instanceof SessionExpiredError) reportError(err);
      });
    return () => controller.abort();
  });

  const rows = $derived(data?.items ?? []);
  const selectable = $derived(rows.filter((r) => !lockReason(r)).length);
  const selection = $derived(pageSelection(rows, selected));
  const selectedRows = $derived(rows.filter((r) => selected.has(r.id)));
  const maxDecide = $derived(data?.maxDecide ?? MAX_DECIDE);
  const counts = $derived.by(() => {
    const out: Record<DecideAction, number> = { approve: 0, reject: 0, defer: 0, requeue: 0 };
    for (const r of selectedRows) for (const a of allowedActions(r)) out[a]++;
    return out;
  });
  const showDecision = $derived(status !== "pending" && status !== "deferred");
  const jobAlerts = $derived.by(() => {
    const c = stats?.commits ?? {};
    return (["failed", "conflict", "pending"] as const).filter((s) => (c[s] ?? 0) > 0).map((s) => ({ status: s, n: c[s] }));
  });

  // ── search ──
  let searchText = $state(untrack(() => q));
  let searchInput = $state<HTMLInputElement>();
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    // Back/Forward changes q under the input; typing must not be overwritten.
    const value = q;
    untrack(() => {
      if (document.activeElement !== searchInput) searchText = value;
    });
  });

  function applySearch() {
    clearTimeout(searchTimer);
    const text = searchText.trim();
    if (text === q) return;
    router.setQuery({ q: text || null, page: null, status: !text && status === "all" ? null : query.get("status") });
  }

  function setTab(tab: QueueStatus | "all") {
    router.setQuery({ status: tab === "pending" ? null : tab, page: null });
  }

  // ── selection ──
  function toggle(row: QueueItem) {
    if (lockReason(row) || busy) return;
    if (selected.has(row.id)) selected.delete(row.id);
    else selected.add(row.id);
  }

  function toggleEveryRow() {
    const next = toggleAll(rows, selected);
    selected.clear();
    for (const id of next) selected.add(id);
  }

  // ── decisions ──
  let confirmOpen = $state(false);
  let confirmAction = $state<DecideAction>("approve");
  let reason = $state("");

  function ask(action: DecideAction) {
    if (busy || !counts[action]) return;
    if (selected.size > maxDecide) {
      toast.error(`At most ${maxDecide} rows per decision.`, { description: "Select fewer rows, or use a smaller page size." });
      return;
    }
    confirmAction = action;
    reason = "";
    confirmOpen = true;
  }

  const duplicateAppids = $derived.by(() => {
    const seen = new Map<string, number>();
    for (const r of selectedRows) seen.set(r.appid, (seen.get(r.appid) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([appid]) => appid));
  });

  async function decide() {
    if (busy) return;
    const action = confirmAction;
    const sent = selectedRows.slice();
    const names = new Map(sent.map((r) => [r.id, r.name || r.appid]));
    const describe = (skipped: SkippedRow[]) =>
      skipped.map((s) => `${names.get(s.id) ?? s.id} (${SKIP_TEXT[s.reason] ?? s.reason})`).join("; ");

    busy = true;
    try {
      const res = await api<DecideResponse | { error: string; skipped: SkippedRow[] }>("/api/admin/decide", {
        method: "POST",
        body: { ids: sent.map((r) => r.id), action, reason: reason.trim() },
        accept: [409],
      });
      if ("error" in res) {
        toast.warning("Nothing was decided", { description: describe(res.skipped) });
      } else {
        const parts: string[] = [];
        if (action === "approve") {
          parts.push(res.commit ? `Commit ${shortSha(res.commit)}.` : "No commit: every link was already queued.");
        }
        if (res.skipped.length) parts.push(`Skipped ${res.skipped.length}: ${describe(res.skipped)}.`);
        const commit = res.commit;
        toast.success(`${ACTION_PAST[action]} ${plural(res.decided, "row")}`, {
          description: parts.join(" ") || undefined,
          action: commit ? { label: "View commit", onClick: () => window.open(commitUrl(commit), "_blank", "noopener") } : undefined,
        });
      }
    } catch (err) {
      reportError(err, `${ACTION_LABEL[action]} failed`);
    } finally {
      busy = false;
      confirmOpen = false;
      refresh++;
    }
  }

  async function reconcile() {
    if (reconciling) return;
    reconciling = true;
    try {
      const out = await api<ReconcileResponse>("/api/admin/reconcile", { method: "POST" });
      if (out.skipped) toast.info("Reconcile skipped", { description: out.skipped });
      else
        toast.success("Reconcile finished", {
          description: `Checked ${out.checked}: ${out.published} published, ${out.removed} removed, ${out.stale} stale, ${out.swept} swept.`,
        });
    } catch (err) {
      reportError(err, "Reconcile failed");
    } finally {
      reconciling = false;
      refresh++;
    }
  }

  // ── details and keyboard ──
  let detailId = $state<string | null>(null);
  let helpOpen = $state(false);

  async function moveCursor(delta: number) {
    if (!rows.length) return;
    cursor = Math.min(rows.length - 1, Math.max(0, cursor + delta));
    await tick();
    const id = rows[cursor]?.id;
    for (const el of document.querySelectorAll<HTMLElement>(`[data-row="${CSS.escape(id ?? "")}"]`)) {
      if (el.offsetParent !== null) el.scrollIntoView({ block: "nearest" });
    }
  }

  function onKey(e: KeyboardEvent) {
    if (shouldIgnore(e)) return;
    const row = cursor >= 0 ? rows[cursor] : undefined;
    switch (e.key) {
      case "j":
        void moveCursor(1);
        break;
      case "k":
        void moveCursor(-1);
        break;
      case "x":
        if (row) toggle(row);
        break;
      case "a":
        ask("approve");
        break;
      case "r":
        ask("reject");
        break;
      case "d":
        ask(counts.defer ? "defer" : "requeue");
        break;
      case "e":
        if (row) detailId = row.id;
        break;
      case "/":
        searchInput?.focus();
        break;
      case "?":
        helpOpen = true;
        break;
      case "Escape":
        if (!selected.size) return;
        selected.clear();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet selectCell(row: QueueItem)}
  {@const lock = lockReason(row)}
  {#if lock}
    <span class="inline-flex size-4 items-center justify-center text-muted-foreground" title={LOCK_HELP[lock]}>
      <Lock class="size-3.5" aria-hidden="true" />
      <span class="sr-only">{LOCK_HELP[lock]}</span>
    </span>
  {:else}
    <input
      type="checkbox"
      class="size-4 cursor-pointer accent-primary"
      checked={selected.has(row.id)}
      disabled={busy}
      aria-label="Select {row.name || row.appid}"
      onchange={(e) => {
        toggle(row);
        e.currentTarget.checked = selected.has(row.id);
      }}
    />
  {/if}
{/snippet}

{#snippet gameCell(row: QueueItem)}
  <div class="flex min-w-0 items-center gap-3">
    <Thumb src={row.header_image} class="hidden h-[43px] w-[92px] shrink-0 lg:grid" />
    <div class="min-w-0">
      <button
        type="button"
        class="block max-w-full truncate text-left font-medium hover:text-primary hover:underline"
        onclick={() => (detailId = row.id)}
      >
        {row.name || "(no name)"}
      </button>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <a
          href={steamUrl(row.appid)}
          target="_blank"
          rel="noopener noreferrer"
          class="font-mono hover:text-foreground hover:underline"
          title="Open the Steam store page">{row.appid}</a
        >
        {#if row.published && row.status !== "committed"}<Badge variant="success">published</Badge>{/if}
        {#if row.app_type && row.app_type !== "game"}<Badge variant="outline">{row.app_type}</Badge>{/if}
        {#if !row.is_free}<Badge variant="warning">not free</Badge>{/if}
        {#if row.health_status && row.health_status !== "ok"}<Badge variant="warning">{row.health_status}</Badge>{/if}
        <span>{row.source}</span>
      </div>
    </div>
  </div>
{/snippet}

{#snippet decisionCell(row: QueueItem)}
  {#if row.decided_at || row.reject_reason}
    <div class="text-xs">
      {#if row.decided_at}
        <span title={exactTime(row.decided_at)}>{relativeTime(row.decided_at)}</span>
        {#if row.decided_by}<span class="text-muted-foreground"> · {row.decided_by}</span>{/if}
      {/if}
      {#if row.reject_reason}
        <p class="mt-0.5 line-clamp-2 text-muted-foreground" title={row.reject_reason}>{row.reject_reason}</p>
      {/if}
    </div>
  {:else}
    <span class="text-muted-foreground">—</span>
  {/if}
{/snippet}

<section class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Review queue</h1>
      <p class="text-sm text-muted-foreground">
        Candidates found by discovery and the browser extension. Approving asks the pipeline to publish a game.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {#each jobAlerts as alert (alert.status)}
        <a
          href="/admin/jobs?status={alert.status}"
          class="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning/20"
        >
          <TriangleAlert class="size-3.5" />
          {plural(alert.n, "commit job")}
          {alert.status}
        </a>
      {/each}
      <Button variant="outline" size="sm" onclick={reconcile} disabled={reconciling} title="Check approved rows against data/ now">
        <RefreshCw class="size-4 {reconciling ? 'animate-spin' : ''}" />
        Reconcile
      </Button>
      <Button variant="ghost" size="sm" onclick={() => (helpOpen = true)} aria-label="Keyboard shortcuts">
        <Keyboard class="size-4" />
      </Button>
    </div>
  </div>

  <!-- tabs -->
  <div class="-mx-1 overflow-x-auto px-1 scrollbar-thin">
    <div role="tablist" aria-label="Queue status" class="flex min-w-max gap-1 border-b border-border">
      {#each TABS as tab (tab)}
        {@const n = stats?.queue[tab]}
        <button
          type="button"
          role="tab"
          aria-selected={status === tab}
          title={STATUS_HELP[tab]}
          class="-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors
            {status === tab
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => setTab(tab)}
        >
          {tab}
          <span
            class="tnum rounded-full px-1.5 py-0.5 text-[11px] leading-none {status === tab
              ? 'bg-primary/15 text-primary'
              : 'bg-muted text-muted-foreground'}"
          >
            {n ?? (stats ? 0 : "…")}
          </span>
        </button>
      {/each}
      {#if status === "all"}
        <span role="tab" aria-selected="true" class="-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium">
          All statuses
        </span>
      {/if}
    </div>
  </div>

  <!-- toolbar -->
  <div class="flex flex-wrap items-center gap-2">
    <form
      class="relative min-w-56 flex-1 sm:max-w-sm"
      role="search"
      onsubmit={(e) => {
        e.preventDefault();
        applySearch();
      }}
    >
      <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        bind:this={searchInput}
        bind:value={searchText}
        type="search"
        placeholder="Search name or appid"
        aria-label="Search the queue by name or appid"
        maxlength="80"
        class="h-9 w-full rounded-md border border-input bg-background pr-10 pl-8 text-sm placeholder:text-muted-foreground"
        oninput={() => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(applySearch, 350);
        }}
        onkeydown={(e) => {
          if (e.key === "Escape") {
            searchText = "";
            applySearch();
            searchInput?.blur();
          }
        }}
      />
      <span class="absolute top-1/2 right-2 -translate-y-1/2"><Kbd>/</Kbd></span>
    </form>
    {#if q}
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="size-4 accent-primary"
          checked={status === "all"}
          onchange={(e) => router.setQuery({ status: e.currentTarget.checked ? "all" : null, page: null })}
        />
        Search every status
      </label>
    {/if}
    <label class="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
      Sort
      <select
        class="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        value={sort}
        onchange={(e) => router.setQuery({ sort: e.currentTarget.value === "newest" ? null : e.currentTarget.value, page: null })}
      >
        {#each SORTS as s (s.value)}
          <option value={s.value}>{s.label}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if loadError && !data}
    <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <p class="font-medium text-destructive">The queue could not be loaded.</p>
      <p class="mt-1 text-muted-foreground">{loadError}</p>
      <Button class="mt-3" variant="outline" size="sm" onclick={() => refresh++}>Try again</Button>
    </div>
  {:else if !data}
    <div class="overflow-hidden rounded-lg border border-border" aria-busy="true" aria-label="Loading the queue">
      {#each Array(8) as _, i (i)}
        <div class="flex items-center gap-4 border-b border-border px-3 py-3 last:border-b-0">
          <div class="size-4 animate-pulse rounded bg-muted"></div>
          <div class="hidden h-[43px] w-[92px] animate-pulse rounded bg-muted lg:block"></div>
          <div class="flex-1 space-y-2">
            <div class="h-3.5 w-1/3 animate-pulse rounded bg-muted"></div>
            <div class="h-3 w-1/5 animate-pulse rounded bg-muted"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else if !rows.length}
    <div class="rounded-lg border border-border">
      <EmptyState icon={Inbox} title={q ? `Nothing matches “${q}”` : EMPTY[status as QueueStatus]}>
        {#if q && status !== "all"}
          It may be in another tab.
          <button type="button" class="font-medium text-primary hover:underline" onclick={() => setTab("all")}>
            Search every status
          </button>
        {/if}
      </EmptyState>
    </div>
  {:else}
    <div class="relative" inert={busy || loading} class:opacity-60={loading}>
      <!-- table, md and up -->
      <div class="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table class="w-full text-sm">
          <thead class="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th class="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  class="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
                  aria-label="Select every row on this page that can be decided"
                  title={selectable ? "Select every row on this page that can be decided" : "Nothing on this page can be decided"}
                  checked={selection === "all"}
                  disabled={!selectable}
                  {@attach (node: HTMLInputElement) => {
                    node.indeterminate = selection === "some";
                  }}
                  onchange={toggleEveryRow}
                />
              </th>
              <th class="px-3 py-2.5">Game</th>
              {#if status === "all"}<th class="px-3 py-2.5">Status</th>{/if}
              <th class="px-3 py-2.5 text-right">Players</th>
              <th class="px-3 py-2.5">Reviews</th>
              <th class="px-3 py-2.5">Released</th>
              <th class="px-3 py-2.5">First seen</th>
              {#if showDecision}<th class="px-3 py-2.5">Decision</th>{/if}
              <th class="w-10 px-3 py-2.5"><span class="sr-only">Details</span></th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row, i (row.id)}
              {@const lock = lockReason(row)}
              <tr
                data-row={row.id}
                class="border-t border-border transition-colors
                  {selected.has(row.id) ? 'bg-primary/8' : 'hover:bg-muted/40'}
                  {cursor === i ? 'outline-2 -outline-offset-2 outline-primary/70' : ''}"
                onclick={(e) => {
                  cursor = i;
                  // A click on the row body toggles, like a mail client; links,
                  // buttons and the checkbox keep their own behaviour.
                  if (!lock && !(e.target as Element).closest("a, button, input")) toggle(row);
                }}
              >
                <td class="px-3 py-2">{@render selectCell(row)}</td>
                <td class="max-w-[28rem] px-3 py-2">{@render gameCell(row)}</td>
                {#if status === "all"}<td class="px-3 py-2"><StatusBadge status={row.status} /></td>{/if}
                <td class="tnum px-3 py-2 text-right whitespace-nowrap">{row.current_players_raw || "—"}</td>
                <td class="px-3 py-2 text-xs whitespace-nowrap">{row.reviews_raw || "—"}</td>
                <td class="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">{row.release_date || "—"}</td>
                <td class="px-3 py-2 text-xs whitespace-nowrap">
                  <span title={exactTime(row.first_seen_at)}>{relativeTime(row.first_seen_at)}</span>
                  {#if row.seen_count > 1}
                    <span class="text-muted-foreground" title="Seen {row.seen_count} times">×{row.seen_count}</span>
                  {/if}
                </td>
                {#if showDecision}<td class="max-w-56 px-3 py-2">{@render decisionCell(row)}</td>{/if}
                <td class="px-2 py-2">
                  <Button variant="ghost" size="icon" class="size-8" aria-label="Details for {row.name || row.appid}" onclick={() => (detailId = row.id)}>
                    <Eye class="size-4" />
                  </Button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- cards, below md -->
      <div class="space-y-2 md:hidden">
        {#if selectable}
          <label class="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <input
              type="checkbox"
              class="size-4 accent-primary"
              checked={selection === "all"}
              {@attach (node: HTMLInputElement) => {
                node.indeterminate = selection === "some";
              }}
              onchange={toggleEveryRow}
            />
            Select every row that can be decided
          </label>
        {/if}
        <ul class="space-y-2">
          {#each rows as row, i (row.id)}
            <li
              data-row={row.id}
              class="rounded-lg border p-3 {selected.has(row.id) ? 'border-primary/60 bg-primary/5' : 'border-border'}
                {cursor === i ? 'outline-2 outline-primary/70' : ''}"
            >
              <div class="flex items-start gap-3">
                <div class="pt-0.5">{@render selectCell(row)}</div>
                <div class="min-w-0 flex-1 space-y-2">
                  {@render gameCell(row)}
                  <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {#if status === "all"}<StatusBadge status={row.status} />{/if}
                    <span>Players {row.current_players_raw || "—"}</span>
                    <span>{row.reviews_raw || "No reviews"}</span>
                    <span title={exactTime(row.first_seen_at)}>Seen {relativeTime(row.first_seen_at)}</span>
                  </div>
                  {#if showDecision}{@render decisionCell(row)}{/if}
                </div>
                <Button variant="ghost" size="icon" class="size-8 shrink-0" aria-label="Details for {row.name || row.appid}" onclick={() => (detailId = row.id)}>
                  <Eye class="size-4" />
                </Button>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <Pager
      offset={data.offset}
      limit={data.limit}
      total={data.total}
      count={data.count}
      disabled={loading || busy}
      sizes={SIZES}
      onpage={(o) => router.setQuery({ page: o / size + 1 === 1 ? null : o / size + 1 })}
      onsize={(n) => router.setQuery({ size: n === 50 ? null : n, page: null })}
    />
  {/if}
</section>

{#if selected.size}
  <div class="pointer-events-none sticky bottom-4 z-20 mt-4 flex justify-center">
    <div
      class="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-border-strong bg-card/95 px-3 py-2 shadow-xl backdrop-blur"
      role="toolbar"
      aria-label="Decide the selected rows"
    >
      <span class="px-1 text-sm font-medium tnum">{plural(selected.size, "row")} selected</span>
      {#if selected.size > maxDecide}
        <span class="text-xs text-destructive">at most {maxDecide} per decision</span>
      {/if}
      <Button variant="ghost" size="sm" onclick={() => selected.clear()} disabled={busy}>Clear <Kbd class="hidden sm:inline-flex">Esc</Kbd></Button>
      <span class="mx-1 hidden h-5 w-px bg-border sm:block"></span>
      <Button size="sm" onclick={() => ask("approve")} disabled={busy || !counts.approve}>
        <Check class="size-4" /> Approve <Kbd class="hidden sm:inline-flex">a</Kbd>
      </Button>
      <Button size="sm" variant="destructive" onclick={() => ask("reject")} disabled={busy || !counts.reject}>
        <X class="size-4" /> Reject <Kbd class="hidden sm:inline-flex">r</Kbd>
      </Button>
      {#if counts.defer}
        <Button size="sm" variant="outline" onclick={() => ask("defer")} disabled={busy}>
          <Clock class="size-4" /> Defer <Kbd class="hidden sm:inline-flex">d</Kbd>
        </Button>
      {/if}
      {#if counts.requeue}
        <Button size="sm" variant="outline" onclick={() => ask("requeue")} disabled={busy}>
          <Undo2 class="size-4" /> Back to pending {#if !counts.defer}<Kbd class="hidden sm:inline-flex">d</Kbd>{/if}
        </Button>
      {/if}
    </div>
  </div>
{/if}

<Dialog
  bind:open={confirmOpen}
  title="{ACTION_LABEL[confirmAction]} {plural(selectedRows.length, 'row')}?"
  description={ACTION_CONSEQUENCE[confirmAction]}
  size="lg"
  dismissable={!busy}
>
  <form
    id="decide-form"
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      void decide();
    }}
  >
    <ul class="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm">
      {#each selectedRows as row (row.id)}
        {@const applies = allowedActions(row).includes(confirmAction)}
        <li class="flex items-center gap-3 px-3 py-2">
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{row.name || "(no name)"}</p>
            <p class="font-mono text-xs text-muted-foreground">{row.appid}</p>
          </div>
          {#if !applies}
            <span class="text-xs text-warning">skipped: already in that state</span>
          {:else if duplicateAppids.has(row.appid)}
            <span class="text-xs text-warning">same game selected twice: the newest row is used</span>
          {/if}
          <StatusBadge status={row.status} />
        </li>
      {/each}
    </ul>
    <label class="block space-y-1.5 text-sm">
      <span class="font-medium">Reason <span class="font-normal text-muted-foreground">(optional)</span></span>
      <input
        bind:value={reason}
        data-autofocus
        type="text"
        maxlength="300"
        autocomplete="off"
        placeholder={confirmAction === "reject"
          ? "Shown on the row and kept with the rejection"
          : confirmAction === "approve"
            ? "Kept in the commit message and the audit log"
            : "Kept in the audit log"}
        class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground"
      />
    </label>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmOpen = false)} disabled={busy}>Cancel</Button>
    <Button type="submit" form="decide-form" variant={confirmAction === "reject" ? "destructive" : "default"} disabled={busy}>
      {#if busy}<LoaderCircle class="size-4 animate-spin" />{/if}
      {ACTION_LABEL[confirmAction]}
      {plural(counts[confirmAction], "row")}
    </Button>
  {/snippet}
</Dialog>

<Dialog bind:open={helpOpen} title="Keyboard shortcuts" size="sm">
  <dl class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
    {#each QUEUE_SHORTCUTS as s (s.key)}
      <dt><Kbd>{s.key === "Escape" ? "Esc" : s.key}</Kbd></dt>
      <dd>{s.label}</dd>
    {/each}
  </dl>
  <p class="mt-4 text-xs text-muted-foreground">Shortcuts do nothing while you type in a field or a dialog is open.</p>
</Dialog>

<CandidateDialog
  id={detailId}
  onselect={(id) => (detailId = id)}
  onclose={() => (detailId = null)}
  onchanged={() => refresh++}
/>
