<!--
  Remove published games (up to 100 at a time) and restore one.

  A removal is a line in data/blocklist.jsonl, applied by the pipeline on its
  next run and on every run after (scripts/core/blocklist.py). The reason and
  the note are PUBLIC - the file lives in a public repository - and the page
  says so before anything is committed.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import Search from "@lucide/svelte/icons/search";
  import ArchiveX from "@lucide/svelte/icons/archive-x";
  import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
  import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Button from "../../../src/lib/ui/Button.svelte";
  import Badge from "../../../src/lib/ui/Badge.svelte";
  import Dialog from "../components/Dialog.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Thumb from "../components/Thumb.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { isAbort, reportError } from "../lib/notify";
  import { router } from "../lib/router.svelte";
  import { commitUrl, exactTime, formatInt, plural, relativeTime, shortSha, steamUrl } from "../lib/format";
  import {
    MAX_NOTE,
    MAX_REMOVE,
    parseAppidList,
    REMOVAL_REASON_CODES,
    REMOVAL_REASONS,
    type RemovalReason,
  } from "../../../shared/removal";
  import type {
    CatalogueGameSummary,
    CataloguePreviewResponse,
    CatalogueSearchResponse,
    RemovedResponse,
    RemoveResponse,
    RestoreResponse,
  } from "../../../shared/admin-api";

  const tab = $derived(router.query.get("tab") === "removed" ? "removed" : "remove");

  // ── selection ──
  let selected = $state<CatalogueGameSummary[]>([]);
  const selectedIds = $derived(new Set(selected.map((g) => g.appid)));

  function add(game: CatalogueGameSummary) {
    if (selectedIds.has(game.appid)) return;
    if (selected.length >= MAX_REMOVE) {
      toast.error(`At most ${MAX_REMOVE} games at once.`);
      return;
    }
    selected = [...selected, game];
  }

  function drop(appid: string) {
    selected = selected.filter((g) => g.appid !== appid);
  }

  // ── search ──
  let searchText = $state("");
  let results = $state.raw<CatalogueSearchResponse | null>(null);
  let searching = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchController: AbortController | undefined;

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 300);
  }

  async function runSearch() {
    const q = searchText.trim();
    searchController?.abort();
    if (q.length < 2) {
      results = null;
      return;
    }
    const controller = new AbortController();
    searchController = controller;
    searching = true;
    try {
      results = await api<CatalogueSearchResponse>(`catalogue?q=${encodeURIComponent(q)}&limit=30`, { signal: controller.signal });
    } catch (err) {
      if (!isAbort(err)) reportError(err, "Search failed");
    } finally {
      if (searchController === controller) searching = false;
    }
  }

  // ── paste ──
  let pasteText = $state("");
  let pasting = $state(false);

  async function addPasted(text: string) {
    const { appids, invalid } = parseAppidList(text);
    if (!appids.length) {
      toast.error("No Steam appid or store link found in that text.");
      return;
    }
    const room = MAX_REMOVE - selected.length;
    const wanted = appids.filter((a) => !selectedIds.has(a)).slice(0, Math.max(room, 0));
    if (!wanted.length) {
      toast.info(room <= 0 ? `The selection already holds ${MAX_REMOVE} games.` : "Those games are already selected.");
      return;
    }
    pasting = true;
    try {
      const res = await api<CataloguePreviewResponse>(`catalogue?appids=${wanted.join(",")}`);
      const notFound = res.items.filter((i) => !i.found).map((i) => i.appid);
      const blocked = res.items.filter((i) => i.found && i.blocked).map((i) => i.appid);
      for (const i of res.items) if (i.found && i.game && !i.blocked) add(i.game);
      const parts = [];
      if (notFound.length) parts.push(`not in the catalogue: ${notFound.join(", ")}`);
      if (blocked.length) parts.push(`already removed: ${blocked.join(", ")}`);
      if (invalid.length) parts.push(`not understood: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? " …" : ""}`);
      if (appids.length - wanted.length > 0 && room < appids.length) parts.push(`over the ${MAX_REMOVE}-game limit or already selected`);
      if (parts.length) toast.warning("Some lines were left out", { description: parts.join("; ") });
      pasteText = "";
    } catch (err) {
      reportError(err, "Looking the games up failed");
    } finally {
      pasting = false;
    }
  }

  // A deep link from the Edit or Quality page: /admin/remove?appids=730
  $effect(() => {
    const preset = router.query.get("appids");
    if (!preset) return;
    untrack(() => {
      router.setQuery({ appids: null });
      void addPasted(preset.split(",").join(" "));
    });
  });

  // ── remove ──
  let reason = $state<RemovalReason>("not_free");
  let note = $state("");
  let reviewOpen = $state(false);
  let removing = $state(false);
  const noteNeeded = $derived(reason === "other" && !note.trim());

  async function remove() {
    removing = true;
    try {
      const res = await api<RemoveResponse>("remove", {
        method: "POST",
        body: { appids: selected.map((g) => g.appid), reason, note: note.trim() },
        accept: [409],
      });
      if ("error" in res) {
        toast.warning("Nothing was removed", { description: String((res as { error: string }).error) });
        return;
      }
      const sha = res.commit;
      const parts = [];
      if (res.repaired.length) parts.push(`${res.repaired.length} already removed (queue repaired)`);
      const skipped = res.skipped.filter((s) => s.reason === "not-in-catalogue");
      if (skipped.length) parts.push(`${skipped.length} no longer in the catalogue`);
      toast.success(`Removed ${plural(res.removed.length, "game")}`, {
        description:
          (sha ? `Commit ${shortSha(sha)}. The pipeline takes them out of data/ on its next run.` : "No commit needed.") +
          (parts.length ? ` ${parts.join("; ")}.` : ""),
        action: sha ? { label: "View commit", onClick: () => window.open(commitUrl(sha), "_blank", "noopener") } : undefined,
      });
      selected = [];
      note = "";
      results = null;
      searchText = "";
      router.setQuery({ tab: "removed" });
    } catch (err) {
      reportError(err, "Removing failed");
    } finally {
      removing = false;
      reviewOpen = false;
    }
  }

  // ── removed list ──
  let removed = $state.raw<RemovedResponse | null>(null);
  let removedError = $state<string | null>(null);
  let refresh = $state(0);

  $effect(() => {
    if (tab !== "removed") return;
    void refresh;
    const controller = new AbortController();
    untrack(() => (removedError = null));
    api<RemovedResponse>("removed", { signal: controller.signal })
      .then((res) => (removed = res))
      .catch((err) => {
        if (isAbort(err)) return;
        removedError = errorMessage(err);
        if (err instanceof SessionExpiredError) reportError(err);
      });
    return () => controller.abort();
  });

  let restoreTarget = $state<{ appid: string; name: string } | null>(null);
  let restoring = $state(false);

  async function restore() {
    if (!restoreTarget) return;
    restoring = true;
    try {
      const res = await api<RestoreResponse>("restore", { method: "POST", body: { appid: restoreTarget.appid }, accept: [409] });
      if ("error" in res) {
        toast.warning("Nothing was restored", { description: String((res as { error: string }).error) });
      } else {
        const sha = res.commit;
        toast.success(`Restored ${restoreTarget.name || restoreTarget.appid}`, {
          description: "Unblocked, and queued for ingest_new.py in the same commit.",
          action: sha ? { label: "View commit", onClick: () => window.open(commitUrl(sha), "_blank", "noopener") } : undefined,
        });
      }
    } catch (err) {
      reportError(err, "Restoring failed");
    } finally {
      restoring = false;
      restoreTarget = null;
      refresh++;
    }
  }
</script>

<section class="space-y-5">
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">Remove games</h1>
    <p class="max-w-3xl text-sm text-muted-foreground">
      A removed game leaves data/ on the next pipeline run, is listed on the site's removed-games page, and stays out:
      discovery, a queued link and every later run skip it until it is restored here.
    </p>
  </div>

  <div class="flex gap-1 border-b border-border" role="tablist">
    {#each [["remove", "Remove"], ["removed", "Removed"]] as [key, label] (key)}
      <button
        type="button"
        role="tab"
        aria-selected={tab === key}
        class="-mb-px border-b-2 px-3 py-2 text-sm font-medium {tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
        onclick={() => router.setQuery({ tab: key === "removed" ? "removed" : null })}
      >
        {label}
      </button>
    {/each}
  </div>

  {#if tab === "remove"}
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 class="font-semibold">Find games</h2>
        <div class="relative">
          <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            bind:value={searchText}
            oninput={onSearchInput}
            placeholder="Name or appid"
            aria-label="Search the catalogue"
            class="h-9 w-full rounded-md border border-input bg-background pr-3 pl-8 text-sm"
          />
        </div>
        {#if searching}
          <p class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Searching…</p>
        {:else if results}
          <p class="text-xs text-muted-foreground">{formatInt(results.total)} match{results.total === 1 ? "" : "es"}{results.total > results.items.length ? `, first ${results.items.length} shown` : ""}</p>
          <ul class="max-h-96 divide-y divide-border overflow-y-auto rounded-md border border-border scrollbar-slim">
            {#each results.items as g (g.appid)}
              <li class="flex items-center gap-3 px-2 py-1.5">
                <Thumb src={g.header_image} class="h-8 w-16 shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm">{g.name || "(no name)"}</p>
                  <p class="font-mono text-xs text-muted-foreground">{g.appid}</p>
                </div>
                {#if g.blocked}
                  <Badge variant="secondary">removed</Badge>
                {:else}
                  <Button variant="outline" size="sm" disabled={selectedIds.has(g.appid)} onclick={() => add(g)}>
                    <Plus class="size-3.5" /> {selectedIds.has(g.appid) ? "Selected" : "Add"}
                  </Button>
                {/if}
              </li>
            {:else}
              <li class="px-3 py-6 text-center text-sm text-muted-foreground">No published game matches.</li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 class="font-semibold">Paste a list</h2>
        <textarea
          bind:value={pasteText}
          rows="6"
          placeholder={"730\nhttps://store.steampowered.com/app/440/\n…"}
          aria-label="Appids or store links, one per line"
          class="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
        ></textarea>
        <Button variant="outline" size="sm" disabled={!pasteText.trim() || pasting} onclick={() => addPasted(pasteText)}>
          {#if pasting}<LoaderCircle class="size-4 animate-spin" />{:else}<ClipboardPaste class="size-4" />{/if}
          Add to the selection
        </Button>
        <p class="text-xs text-muted-foreground">Appids, store or SteamDB links, separated by lines, spaces or commas.</p>
      </div>
    </div>

    <div class="space-y-3 rounded-lg border border-border bg-card p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">Selected ({selected.length}/{MAX_REMOVE})</h2>
        {#if selected.length}<Button variant="ghost" size="sm" onclick={() => (selected = [])}>Clear</Button>{/if}
      </div>
      {#if selected.length}
        <ul class="divide-y divide-border rounded-md border border-border">
          {#each selected as g (g.appid)}
            <li class="flex items-center gap-3 px-2 py-1.5">
              <Thumb src={g.header_image} class="h-8 w-16 shrink-0" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm">{g.name || "(no name)"}</p>
                <p class="text-xs text-muted-foreground">
                  <span class="font-mono">{g.appid}</span>
                  {#if g.release_date}· {g.release_date}{/if}
                  {#if g.is_dead}· <span class="text-warning">no players</span>{/if}
                </p>
              </div>
              <a class="text-muted-foreground hover:text-foreground" href={steamUrl(g.appid)} target="_blank" rel="noopener noreferrer" title="Steam store">
                <ExternalLink class="size-4" />
              </a>
              <Button variant="ghost" size="icon" onclick={() => drop(g.appid)} aria-label="Remove {g.name || g.appid} from the selection">
                <X class="size-4" />
              </Button>
            </li>
          {/each}
        </ul>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="space-y-1 text-sm">
            <span class="font-medium">Reason</span>
            <select bind:value={reason} class="h-9 w-full rounded-md border border-input bg-background px-3">
              {#each REMOVAL_REASON_CODES as code (code)}<option value={code}>{REMOVAL_REASONS[code]}</option>{/each}
            </select>
          </label>
          <label class="space-y-1 text-sm">
            <span class="font-medium">Note {reason === "other" ? "(required)" : "(optional)"}</span>
            <input type="text" bind:value={note} maxlength={MAX_NOTE} class="h-9 w-full rounded-md border border-input bg-background px-3" />
          </label>
        </div>
        <p class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          <TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" />
          The reason and the note are public: they go into data/blocklist.jsonl and the commit, in a public repository.
          The site's removed-games page shows the reason.
        </p>
        <Button variant="destructive" disabled={noteNeeded || removing} onclick={() => (reviewOpen = true)}>
          <ArchiveX class="size-4" /> Review removal of {plural(selected.length, "game")}
        </Button>
      {:else}
        <EmptyState icon={ArchiveX} title="Nothing selected">Find games or paste a list, up to {MAX_REMOVE} at a time.</EmptyState>
      {/if}
    </div>
  {:else}
    <div class="space-y-3">
      {#if removedError}
        <div class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" /> <p>{removedError}</p>
        </div>
      {:else if !removed}
        <p class="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Loading…</p>
      {:else if !removed.items.length}
        <div class="rounded-lg border border-border">
          <EmptyState icon={ArchiveRestore} title="No game has been removed">Removed games are listed here, with Restore.</EmptyState>
        </div>
      {:else}
        <div class="relative overflow-x-auto rounded-lg border border-border">
          <table class="w-full text-sm">
            <thead class="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th class="px-3 py-2 font-medium">Game</th>
                <th class="px-3 py-2 font-medium">Reason</th>
                <th class="px-3 py-2 font-medium">Removed</th>
                <th class="px-3 py-2 font-medium">State</th>
                <th class="px-3 py-2"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {#each removed.items as e (e.appid)}
                <tr class="border-t border-border align-top">
                  <td class="px-3 py-2">
                    <p class="max-w-72 truncate">{e.name || "(no name)"}</p>
                    <p class="font-mono text-xs text-muted-foreground">{e.appid}</p>
                  </td>
                  <td class="px-3 py-2">
                    <p>{REMOVAL_REASONS[e.reason]}</p>
                    {#if e.note}<p class="max-w-72 text-xs break-words text-muted-foreground">{e.note}</p>{/if}
                  </td>
                  <td class="px-3 py-2 whitespace-nowrap text-muted-foreground" title={exactTime(e.blocked_at)}>{relativeTime(e.blocked_at)}</td>
                  <td class="px-3 py-2">
                    {#if e.inCatalogue === true}
                      <Badge variant="warning">waiting for the pipeline</Badge>
                    {:else if e.inCatalogue === false}
                      <Badge variant="secondary">removed</Badge>
                    {:else}
                      <Badge variant="outline">unknown</Badge>
                    {/if}
                  </td>
                  <td class="px-3 py-2 text-right">
                    <Button variant="outline" size="sm" onclick={() => (restoreTarget = { appid: e.appid, name: e.name })}>
                      <ArchiveRestore class="size-3.5" /> Restore…
                    </Button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</section>

<Dialog
  bind:open={reviewOpen}
  title="Remove {plural(selected.length, 'game')} from the catalogue?"
  description="One commit to data/blocklist.jsonl. The pipeline applies it on its next run; Restore brings a game back."
  size="lg"
  dismissable={!removing}
>
  <ul class="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm scrollbar-slim">
    {#each selected as g (g.appid)}
      <li class="flex items-center justify-between gap-3 px-3 py-1.5">
        <span class="min-w-0 truncate">{g.name || "(no name)"}</span>
        <span class="shrink-0 font-mono text-xs text-muted-foreground">{g.appid}</span>
      </li>
    {/each}
  </ul>
  <p class="mt-3 text-sm">Reason: <span class="font-medium">{REMOVAL_REASONS[reason]}</span></p>
  {#if note.trim()}<p class="text-sm">Note: {note.trim()}</p>{/if}
  <p class="mt-2 text-xs text-muted-foreground">Both are public.</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (reviewOpen = false)} disabled={removing}>Back</Button>
    <Button variant="destructive" onclick={remove} disabled={removing}>
      {#if removing}<LoaderCircle class="size-4 animate-spin" />{/if}
      Remove {plural(selected.length, "game")}
    </Button>
  {/snippet}
</Dialog>

<Dialog
  open={!!restoreTarget}
  title="Restore {restoreTarget?.name || restoreTarget?.appid}?"
  description="One commit: the game leaves data/blocklist.jsonl and its store link is queued for ingest_new.py, which fetches it fresh from Steam."
  size="sm"
  dismissable={!restoring}
  onclose={() => (restoreTarget = null)}
>
  <p class="text-sm text-muted-foreground">
    If the game is no longer free or no longer on Steam, the ingest refuses it and its row shows as failed.
  </p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (restoreTarget = null)} disabled={restoring}>Cancel</Button>
    <Button onclick={restore} disabled={restoring}>
      {#if restoring}<LoaderCircle class="size-4 animate-spin" />{:else}<ArchiveRestore class="size-4" />{/if}
      Restore
    </Button>
  {/snippet}
</Dialog>
