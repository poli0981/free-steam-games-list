<!--
  One queue row in full: the candidate as it arrived, the durable decision for
  its game, and every other row the queue holds for the same game.

  Reopen lives here, and only here: it acts on one rejected row at a time, by
  design, never on a selection.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import Lock from "@lucide/svelte/icons/lock";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Button from "../../../src/lib/ui/Button.svelte";
  import Badge from "../../../src/lib/ui/Badge.svelte";
  import Dialog from "../components/Dialog.svelte";
  import Thumb from "../components/Thumb.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { isAbort, reportError } from "../lib/notify";
  import { exactTime, prettyJson, relativeTime, steamUrl } from "../lib/format";
  import { LOCK_HELP, REOPEN_TEXT } from "../lib/labels";
  import { lockReason } from "../../../shared/queue-rules";
  import type { Candidate, ReopenResponse } from "../../../shared/admin-api";

  type Props = {
    id: string | null;
    onclose: () => void;
    onchanged: () => void;
    onselect: (id: string) => void;
  };
  let { id, onclose, onchanged, onselect }: Props = $props();

  const SITE = "https://free-steam-games.win";

  let open = $state(false);
  let data = $state.raw<Candidate | null>(null);
  let error = $state<string | null>(null);
  let confirming = $state(false);
  let reopening = $state(false);
  let reopenError = $state<string | null>(null);

  $effect(() => {
    const current = id;
    untrack(() => {
      data = null;
      error = null;
      confirming = false;
      reopenError = null;
      open = current !== null;
    });
    if (!current) return;

    const controller = new AbortController();
    api<Candidate>(`/api/admin/candidate?id=${encodeURIComponent(current)}`, { signal: controller.signal })
      .then((c) => (data = c))
      .catch((err) => {
        if (isAbort(err)) return;
        if (err instanceof SessionExpiredError) reportError(err);
        error = errorMessage(err);
      });
    return () => controller.abort();
  });

  const lock = $derived(data ? lockReason(data) : null);

  async function reopen() {
    if (!data || reopening) return;
    reopening = true;
    reopenError = null;
    try {
      const res = await api<ReopenResponse | { error: string; reason: string }>("/api/admin/reopen", {
        method: "POST",
        body: { id: data.id },
        accept: [409],
      });
      if ("error" in res) {
        reopenError = REOPEN_TEXT[res.reason] ?? res.error;
        confirming = false;
      } else {
        toast.success("Row reopened", { description: `${data.name || data.appid} is pending again.` });
        onchanged();
        open = false;
      }
    } catch (err) {
      reportError(err, "Reopen failed");
    } finally {
      reopening = false;
    }
  }
</script>

{#snippet fact(label: string, value: string | null | undefined, title?: string)}
  <div class="min-w-0">
    <dt class="text-xs text-muted-foreground">{label}</dt>
    <dd class="truncate text-sm" {title}>{value || "—"}</dd>
  </div>
{/snippet}

<Dialog bind:open title={data?.name || (error ? "Row not loaded" : "Loading…")} size="lg" dismissable={!reopening} {onclose}>
  {#if error}
    <div class="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
      <p>{error}</p>
    </div>
  {:else if !data}
    <div class="flex items-center gap-2 py-10 text-sm text-muted-foreground" aria-busy="true">
      <LoaderCircle class="size-4 animate-spin" /> Loading the row…
    </div>
  {:else}
    <div class="space-y-5">
      <div class="flex flex-col gap-4 sm:flex-row">
        <Thumb src={data.header_image} lazy={false} class="aspect-[460/215] w-full shrink-0 rounded-md sm:w-56" />
        <div class="min-w-0 space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} />
            {#if data.published}<Badge variant="success">in the catalogue</Badge>{/if}
            <span class="font-mono text-xs text-muted-foreground">appid {data.appid}</span>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a class="inline-flex items-center gap-1 text-primary hover:underline" href={steamUrl(data.appid)} target="_blank" rel="noopener noreferrer">
              Steam store <ExternalLink class="size-3.5" />
            </a>
            {#if data.published}
              <a class="inline-flex items-center gap-1 text-primary hover:underline" href="{SITE}/games/{data.appid}" target="_blank" rel="noopener noreferrer">
                Public page <ExternalLink class="size-3.5" />
              </a>
            {/if}
          </div>
          {#if lock}
            <p class="flex items-start gap-2 text-sm text-muted-foreground">
              <Lock class="mt-0.5 size-3.5 shrink-0" />
              {LOCK_HELP[lock]}
            </p>
          {/if}
        </div>
      </div>

      <dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {@render fact("Source", data.source)}
        {@render fact("Type", data.app_type)}
        {@render fact("Free to play", data.is_free ? "yes" : "no")}
        {@render fact("Store health", data.health_status)}
        {@render fact("First seen", relativeTime(data.first_seen_at), exactTime(data.first_seen_at))}
        {@render fact("Last seen", relativeTime(data.last_seen_at), exactTime(data.last_seen_at))}
        {@render fact("Times seen", String(data.seen_count))}
        {@render fact("Decided by", data.decided_by)}
        {@render fact("Decided", data.decided_at ? relativeTime(data.decided_at) : null, exactTime(data.decided_at))}
      </dl>

      {#if data.reject_reason}
        <div class="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p class="text-xs text-muted-foreground">{data.status === "rejected" ? "Rejection reason" : "Reason"}</p>
          <p class="mt-0.5 break-words">{data.reject_reason}</p>
        </div>
      {/if}

      <section class="space-y-2">
        <h3 class="text-sm font-semibold">Decision for this game</h3>
        {#if data.decision}
          <div class="rounded-md border border-border p-3 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <StatusBadge status={data.decision.decision} />
              <span class="text-muted-foreground" title={exactTime(data.decision.decided_at)}>
                {relativeTime(data.decision.decided_at)}{data.decision.decided_by ? ` by ${data.decision.decided_by}` : ""}
              </span>
            </div>
            {#if data.decision.reason}<p class="mt-1.5 break-words">{data.decision.reason}</p>{/if}
            <p class="mt-1.5 text-xs text-muted-foreground">
              {data.decision.decision === "approved"
                ? "Recorded when the game was seen in data/. It is what keeps every row for this game read-only."
                : "Discovery will not offer this game again while this rejection stands."}
            </p>
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">No durable decision is recorded for this game.</p>
        {/if}
      </section>

      <section class="space-y-2">
        <h3 class="text-sm font-semibold">Other rows for this game</h3>
        {#if data.siblings.length}
          <ul class="divide-y divide-border rounded-md border border-border text-sm">
            {#each data.siblings as s (s.id)}
              <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <StatusBadge status={s.status} />
                <button type="button" class="font-mono text-xs text-primary hover:underline" onclick={() => onselect(s.id)}>
                  {s.id}
                </button>
                <span class="text-xs text-muted-foreground" title={exactTime(s.first_seen_at)}>
                  seen {relativeTime(s.first_seen_at)}
                </span>
                {#if s.decided_at}
                  <span class="text-xs text-muted-foreground" title={exactTime(s.decided_at)}>
                    decided {relativeTime(s.decided_at)}{s.decided_by ? ` by ${s.decided_by}` : ""}
                  </span>
                {/if}
                {#if s.reject_reason}<span class="w-full truncate text-xs text-muted-foreground" title={s.reject_reason}>{s.reject_reason}</span>{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-muted-foreground">None.</p>
        {/if}
      </section>

      <details class="group rounded-md border border-border">
        <summary class="cursor-pointer px-3 py-2 text-sm font-semibold select-none">Payload as submitted</summary>
        <pre class="max-h-80 overflow-auto border-t border-border bg-muted/40 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words">{prettyJson(
            data.payload_json,
          )}</pre>
      </details>

    </div>
  {/if}

  {#snippet footer()}
    {#if reopenError}
      <div class="flex w-full items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="alert">
        <CircleAlert class="mt-0.5 size-4 shrink-0 text-warning" />
        <p>{reopenError}</p>
      </div>
    {/if}
    {#if confirming}
      <div class="w-full rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" role="alert">
        <p class="font-medium">Reopen this row?</p>
        <p class="mt-1 text-muted-foreground">
          It goes back to pending and the rejection recorded for the game is removed, so discovery can offer it again.
        </p>
      </div>
    {/if}
    {#if data?.status === "rejected"}
      {#if confirming}
        <Button variant="ghost" onclick={() => (confirming = false)} disabled={reopening}>Keep rejected</Button>
        <Button onclick={reopen} disabled={reopening}>
          {#if reopening}<LoaderCircle class="size-4 animate-spin" />{:else}<RotateCcw class="size-4" />{/if}
          Reopen
        </Button>
      {:else}
        <Button variant="outline" onclick={() => ((confirming = true), (reopenError = null))}>
          <RotateCcw class="size-4" /> Reopen…
        </Button>
      {/if}
    {/if}
    {#if data?.published}
      <Button variant="outline" href="/admin/edit?appid={data.appid}" onclick={() => (open = false)}>
        <SquarePen class="size-4" /> Correct this game
      </Button>
    {/if}
    <Button variant="ghost" onclick={() => (open = false)} disabled={reopening}>Close</Button>
  {/snippet}
</Dialog>
