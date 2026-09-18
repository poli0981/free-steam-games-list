<!--
  One change to up to MAX_EDIT games at once, picked by genre.

  The selection is kept across pages and genres (a Map, not the page's rows),
  so a retag can gather games from two vague buckets. The review dialog loads
  each selected game before anything is committed and shows what the change
  does to each one.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import X from "@lucide/svelte/icons/x";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Layers from "@lucide/svelte/icons/layers";
  import Button from "../../../src/lib/ui/Button.svelte";
  import Dialog from "../components/Dialog.svelte";
  import Thumb from "../components/Thumb.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import FieldEditor from "../components/FieldEditor.svelte";
  import Pager from "../components/Pager.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { commitToast, isAbort, reportError } from "../lib/notify";
  import { router } from "../lib/router.svelte";
  import { FIELDS, FIELD_LABEL, toWire, validate } from "../lib/fields";
  import { plural, showValue } from "../lib/format";
  import { MAX_EDIT } from "../../../shared/queue-rules";
  import type { ByGenreResponse, EditResponse, GameResponse, ManualField } from "../../../shared/admin-api";

  type Props = {
    genres: { genre: string; count: number }[];
    busy: boolean;
    ongenres: () => void;
  };
  let { genres, busy = $bindable(), ongenres }: Props = $props();

  const PAGE = 60;

  const genre = $derived(router.query.get("genre") ?? "");
  const page = $derived(Math.max(1, Math.floor(Number(router.query.get("page"))) || 1));
  const offset = $derived((page - 1) * PAGE);

  let list = $state.raw<ByGenreResponse | null>(null);
  let loadError = $state<string | null>(null);
  let loading = $state(false);
  let reload = $state(0);

  const selected = new SvelteMap<string, string>();
  const full = $derived(selected.size >= MAX_EDIT);

  let field = $state<ManualField>("genre");
  let op = $state<"set" | "retire">("set");
  let value = $state("");
  let reason = $state("");
  const spec = $derived(FIELDS.find((f) => f.key === field)!);
  const valueError = $derived(op === "set" ? validate(field, value) : null);

  $effect(() => {
    const g = genre;
    const o = offset;
    void reload;
    untrack(() => {
      loadError = null;
      if (!g) list = null;
    });
    if (!g) return;
    const controller = new AbortController();
    untrack(() => (loading = true));
    api<ByGenreResponse>(`by-genre?${new URLSearchParams({ genre: g, limit: String(PAGE), offset: String(o) })}`, {
      signal: controller.signal,
    })
      .then((res) => {
        list = res;
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

  $effect(() => {
    // A new field starts from a sensible value rather than the last field's.
    const f = field;
    untrack(() => {
      value = f === "is_kernel_ac" ? "null" : f === "safe" ? "?" : f === "type_game" ? "online" : "";
    });
  });

  $effect(() => router.guard(() => (selected.size ? "Your bulk selection will be lost. Leave anyway?" : null)));

  function toggle(appid: string, name: string) {
    if (busy) return;
    if (selected.has(appid)) selected.delete(appid);
    else if (!full) selected.set(appid, name);
  }

  // ── review ──
  let reviewOpen = $state(false);
  let reviewGames = $state.raw<(GameResponse | { appid: string; error: string })[]>([]);
  let reviewLoading = $state(false);

  async function review() {
    if (!selected.size || valueError || busy) return;
    reviewOpen = true;
    reviewLoading = true;
    reviewGames = [];
    const appids = [...selected.keys()];
    reviewGames = await Promise.all(
      appids.map((a) =>
        api<GameResponse>(`game?appid=${a}`).catch((err: unknown) => {
          if (err instanceof SessionExpiredError) reportError(err);
          return { appid: a, error: errorMessage(err) };
        }),
      ),
    );
    reviewLoading = false;
  }

  function after(g: GameResponse): { text: string; tone: "change" | "same" | "retire" } {
    const active = g.override?.fields?.[field];
    if (op === "retire") {
      return active ? { text: `restores ${showValue(active.was)} once`, tone: "retire" } : { text: "no override on this field: unchanged", tone: "same" };
    }
    const next = toWire(field, value);
    const current = active ? active.value : g.fields[field];
    return JSON.stringify(current ?? null) === JSON.stringify(next)
      ? { text: `${showValue(next)} (already)`, tone: "same" }
      : { text: showValue(next), tone: "change" };
  }

  async function commit() {
    if (busy || !selected.size) return;
    const appids = [...selected.keys()];
    busy = true;
    try {
      const out = await api<EditResponse>("edit", {
        method: "POST",
        body: {
          appids,
          ...(op === "set" ? { set: { [field]: toWire(field, value) } } : { retire: [field] }),
          reason: reason.trim(),
        },
      });
      reviewOpen = false;
      commitToast(
        op === "set"
          ? `${FIELD_LABEL[field]} set on ${plural(appids.length, "game")}`
          : `${FIELD_LABEL[field]} override retired on ${plural(appids.length, "game")}`,
        out.commit,
      );
      selected.clear();
      reason = "";
      reload++;
      ongenres();
    } catch (err) {
      reportError(err, "The bulk change failed");
    } finally {
      busy = false;
    }
  }
</script>

<div class="grid gap-5 lg:grid-cols-[1fr_20rem]">
  <div class="min-w-0 space-y-4">
    <label class="flex max-w-md flex-col gap-1.5 text-sm">
      <span class="font-medium">Games tagged</span>
      <select
        class="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={genre}
        disabled={busy || !genres.length}
        onchange={(e) => router.setQuery({ genre: e.currentTarget.value || null, page: null })}
      >
        <option value="">{genres.length ? "Choose a genre" : "Loading genres…"}</option>
        {#each genres as g (g.genre)}
          <option value={g.genre}>{g.genre} ({g.count})</option>
        {/each}
      </select>
    </label>

    {#if !genre}
      <div class="rounded-lg border border-border">
        <EmptyState icon={Layers} title="Change several games at once">
          Choose a genre to list its games, select up to {MAX_EDIT}, then set or retire one field on all of them in a single
          commit.
        </EmptyState>
      </div>
    {:else if loadError}
      <p class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">{loadError}</p>
    {:else if !list}
      <div class="flex items-center gap-2 py-10 text-sm text-muted-foreground" aria-busy="true">
        <LoaderCircle class="size-4 animate-spin" /> Loading games…
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">
        {plural(list.total, "game")} tagged “{list.genre}”. {full ? `Selection full (${MAX_EDIT}).` : ""}
      </p>
      <ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" class:opacity-60={loading}>
        {#each list.items as item (item.appid)}
          {@const on = selected.has(item.appid)}
          {@const blocked = !on && full}
          <li>
            <label
              class="flex h-full cursor-pointer items-center gap-3 rounded-lg border p-2 transition-colors
                {on ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-muted/40'}
                {blocked ? 'cursor-not-allowed opacity-50' : ''}"
              title={blocked ? `At most ${MAX_EDIT} games per change` : undefined}
            >
              <input
                type="checkbox"
                class="size-4 shrink-0 accent-primary"
                checked={on}
                disabled={blocked || busy}
                onchange={(e) => {
                  toggle(item.appid, item.name);
                  // A refused toggle (the cap, or a click that landed before the
                  // disabled state rendered) must not leave the box ticked.
                  e.currentTarget.checked = selected.has(item.appid);
                }}
              />
              <Thumb src={item.header_image} class="h-9 w-[77px] shrink-0" />
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium">{item.name || "(no name)"}</span>
                <span class="block truncate text-xs text-muted-foreground">
                  <span class="font-mono">{item.appid}</span>{item.release_date ? ` · ${item.release_date}` : ""}
                </span>
              </span>
            </label>
          </li>
        {/each}
      </ul>
      <Pager
        offset={list.offset}
        limit={PAGE}
        total={list.total}
        count={list.items.length}
        disabled={loading || busy}
        onpage={(o) => router.setQuery({ page: o / PAGE + 1 === 1 ? null : o / PAGE + 1 })}
      />
    {/if}
  </div>

  <aside class="h-fit space-y-4 rounded-lg border border-border bg-card p-4 lg:sticky lg:top-20">
    <div>
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">Selected</h3>
        <span class="tnum text-xs text-muted-foreground">{selected.size} / {MAX_EDIT}</span>
      </div>
      {#if selected.size}
        <ul class="mt-2 flex flex-wrap gap-1.5">
          {#each [...selected] as [appid, name] (appid)}
            <li class="flex max-w-full items-center gap-1 rounded-md bg-muted py-0.5 pr-1 pl-2 text-xs">
              <span class="truncate" title={appid}>{name || appid}</span>
              <button
                type="button"
                class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Remove {name || appid}"
                disabled={busy}
                onclick={() => selected.delete(appid)}
              >
                <X class="size-3" />
              </button>
            </li>
          {/each}
        </ul>
        <button type="button" class="mt-2 text-xs text-muted-foreground hover:text-foreground hover:underline" disabled={busy} onclick={() => selected.clear()}>
          Clear selection
        </button>
      {:else}
        <p class="mt-1 text-xs text-muted-foreground">Nothing selected. Tick games in the list.</p>
      {/if}
    </div>

    <label class="block space-y-1.5 text-sm">
      <span class="font-medium">Field</span>
      <select bind:value={field} disabled={busy} class="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
        {#each FIELDS as f (f.key)}
          <option value={f.key}>{f.label}</option>
        {/each}
      </select>
    </label>

    <fieldset class="space-y-1.5 text-sm">
      <legend class="mb-1.5 font-medium">Change</legend>
      <label class="flex items-center gap-2"><input type="radio" class="accent-primary" bind:group={op} value="set" disabled={busy} /> Set a value</label>
      <label class="flex items-center gap-2"><input type="radio" class="accent-primary" bind:group={op} value="retire" disabled={busy} /> Retire the override</label>
    </fieldset>

    {#if op === "set"}
      <div class="space-y-1.5 text-sm">
        <label for="bulk-value" class="font-medium">New {FIELD_LABEL[field].toLowerCase()}</label>
        <FieldEditor {spec} id="bulk-value" bind:value {genres} disabled={busy} invalid={!!valueError && value !== ""} />
        {#if valueError && value !== ""}<p class="text-xs text-destructive">{valueError}</p>{/if}
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">
        Games with an active {FIELD_LABEL[field].toLowerCase()} override get their earlier value back on the next pipeline
        run. Games without one are left alone.
      </p>
    {/if}

    <label class="block space-y-1.5 text-sm">
      <span class="font-medium">Reason <span class="font-normal text-muted-foreground">(optional)</span></span>
      <input
        bind:value={reason}
        type="text"
        maxlength="300"
        disabled={busy}
        class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        placeholder="Kept in the commit and the files"
      />
    </label>

    <Button class="w-full" disabled={busy || !selected.size || !!valueError} onclick={review}>
      Review {plural(selected.size, "game")}
    </Button>
  </aside>
</div>

<Dialog
  bind:open={reviewOpen}
  title={op === "set"
    ? `Set ${FIELD_LABEL[field].toLowerCase()} on ${plural(selected.size, "game")}?`
    : `Retire the ${FIELD_LABEL[field].toLowerCase()} override on ${plural(selected.size, "game")}?`}
  description="One commit, one override file per game. data/ is untouched until the pipeline runs."
  size="lg"
  dismissable={!busy}
>
  {#if reviewLoading}
    <div class="flex items-center gap-2 py-8 text-sm text-muted-foreground" aria-busy="true">
      <LoaderCircle class="size-4 animate-spin" /> Loading the selected games…
    </div>
  {:else}
    <div class="overflow-x-auto rounded-md border border-border">
      <table class="w-full text-sm">
        <thead class="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th class="px-3 py-2">Game</th>
            <th class="px-3 py-2">Catalogue now</th>
            <th class="px-3 py-2">Override now</th>
            <th class="px-3 py-2">After saving</th>
          </tr>
        </thead>
        <tbody>
          {#each reviewGames as g (g.appid)}
            <tr class="border-t border-border align-top">
              {#if "error" in g}
                <td class="px-3 py-2 font-mono">{g.appid}</td>
                <td colspan="3" class="px-3 py-2 text-destructive">{g.error}</td>
              {:else}
                {@const active = g.override?.fields?.[field]}
                {@const outcome = after(g)}
                <td class="px-3 py-2">
                  <span class="block max-w-52 truncate font-medium">{g.name || g.appid}</span>
                  <span class="font-mono text-xs text-muted-foreground">{g.appid}</span>
                </td>
                <td class="px-3 py-2 break-words">{showValue(g.fields[field])}</td>
                <td class="px-3 py-2 break-words text-muted-foreground">
                  {active ? `${showValue(active.value)} (was ${showValue(active.was)})` : "none"}
                </td>
                <td
                  class="px-3 py-2 break-words {outcome.tone === 'change'
                    ? 'font-medium text-primary'
                    : outcome.tone === 'retire'
                      ? 'text-warning'
                      : 'text-muted-foreground'}"
                >
                  {outcome.text}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="mt-3 text-sm">
      Reason: <span class={reason.trim() ? "" : "text-muted-foreground"}>{reason.trim() || "none given"}</span>
    </p>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (reviewOpen = false)} disabled={busy}>Back</Button>
    <Button onclick={commit} disabled={busy || reviewLoading || reviewGames.some((g) => "error" in g)}>
      {#if busy}<LoaderCircle class="size-4 animate-spin" />{/if}
      Commit {plural(selected.size, "override")}
    </Button>
  {/snippet}
</Dialog>
