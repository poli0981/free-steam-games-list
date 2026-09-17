<!--
  Correct one published game by writing data/overrides/<appid>.json.

  Nothing is committed until the diff dialog is confirmed, and the dialog says
  what each change does: a set pins a value, a retire restores the value from
  before the first edit once and then stops acting.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import Search from "@lucide/svelte/icons/search";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import Trash2 from "@lucide/svelte/icons/trash";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import Info from "@lucide/svelte/icons/info";
  import Button from "../../../src/lib/ui/Button.svelte";
  import Badge from "../../../src/lib/ui/Badge.svelte";
  import Dialog from "../components/Dialog.svelte";
  import Thumb from "../components/Thumb.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import FieldEditor from "../components/FieldEditor.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { commitToast, isAbort, reportError } from "../lib/notify";
  import { router } from "../lib/router.svelte";
  import { FIELDS, FIELD_LABEL, toForm, toWire, validate } from "../lib/fields";
  import { exactTime, fileUrl, plural, relativeTime, showValue, steamUrl } from "../lib/format";
  import type { EditResponse, GameResponse, ManualField, OverrideEntry } from "../../../shared/admin-api";

  type Props = {
    genres: { genre: string; count: number }[];
    busy: boolean;
    ongenres: () => void;
  };
  let { genres, busy = $bindable(), ongenres }: Props = $props();

  const SITE = "https://free-steam-games.win";
  const blank = () => Object.fromEntries(FIELDS.map((f) => [f.key, ""])) as Record<ManualField, string>;

  const appid = $derived((router.query.get("appid") ?? "").trim());
  let appidText = $state(untrack(() => appid));

  let game = $state.raw<GameResponse | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let reload = $state(0);

  let initial = $state.raw<Record<ManualField, string>>(blank());
  let form = $state<Record<ManualField, string>>(blank());
  const retire = new SvelteSet<ManualField>();
  let reason = $state("");

  function activeOf(g: GameResponse, field: ManualField): OverrideEntry | undefined {
    return g.override?.fields?.[field];
  }

  function retiredOf(g: GameResponse, field: ManualField): OverrideEntry | undefined {
    return g.override?.retired?.[field];
  }

  $effect(() => {
    const id = appid;
    void reload;
    untrack(() => {
      appidText = id;
      loadError = null;
    });
    if (!id) {
      untrack(() => (game = null));
      return;
    }
    if (!/^\d{1,10}$/.test(id)) {
      untrack(() => {
        game = null;
        loadError = "An appid is 1 to 10 digits.";
      });
      return;
    }

    const controller = new AbortController();
    untrack(() => (loading = true));
    api<GameResponse>(`/api/admin/game?appid=${id}`, { signal: controller.signal })
      .then((g) => {
        // The form starts from what the catalogue WILL hold: the override's
        // value where one is active (it may not have been applied yet),
        // otherwise the catalogue's.
        const next = blank();
        for (const f of FIELDS) {
          const active = activeOf(g, f.key);
          next[f.key] = toForm(f.key, active ? active.value : g.fields[f.key]);
        }
        game = g;
        initial = next;
        form = { ...next };
        retire.clear();
        loading = false;
      })
      .catch((err) => {
        if (isAbort(err)) return;
        loading = false;
        game = null;
        loadError = errorMessage(err);
        if (err instanceof SessionExpiredError) reportError(err);
      });
    return () => controller.abort();
  });

  const changes = $derived(
    FIELDS.map((f) => f.key).filter((k) => !retire.has(k) && form[k].trim() !== initial[k].trim()),
  );
  const errors = $derived(
    Object.fromEntries(changes.map((k) => [k, validate(k, form[k])]).filter(([, e]) => e)) as Partial<
      Record<ManualField, string>
    >,
  );
  const dirty = $derived(changes.length > 0 || retire.size > 0);
  const invalid = $derived(Object.keys(errors).length > 0);

  $effect(() => router.guard(() => (dirty ? "This game has unsaved changes. Discard them?" : null)));

  function load(e: SubmitEvent) {
    e.preventDefault();
    const text = appidText.trim();
    const parsed = /\/app\/(\d+)/.exec(text)?.[1] ?? text;
    if (parsed === appid) {
      reload++;
      return;
    }
    if (!router.confirmLeave()) return;
    router.setQuery({ appid: parsed || null });
  }

  function discard() {
    form = { ...initial };
    retire.clear();
  }

  // ── save ──
  let reviewOpen = $state(false);
  let deleteOpen = $state(false);

  interface PlanRow {
    field: ManualField;
    kind: "set" | "retire";
    catalogue: unknown;
    active: OverrideEntry | undefined;
    next: unknown;
  }

  const plan = $derived.by((): PlanRow[] => {
    if (!game) return [];
    const g = game;
    return [
      ...changes.map((k) => ({ field: k, kind: "set" as const, catalogue: g.fields[k], active: activeOf(g, k), next: toWire(k, form[k]) })),
      ...[...retire].map((k) => ({ field: k, kind: "retire" as const, catalogue: g.fields[k], active: activeOf(g, k), next: activeOf(g, k)?.was })),
    ];
  });

  async function save() {
    if (!game || busy || invalid || !dirty) return;
    const set = Object.fromEntries(changes.map((k) => [k, toWire(k, form[k])]));
    busy = true;
    try {
      const out = await api<EditResponse>("/api/admin/edit", {
        method: "POST",
        body: {
          appids: [game.appid],
          ...(changes.length ? { set } : {}),
          ...(retire.size ? { retire: [...retire] } : {}),
          reason: reason.trim(),
        },
      });
      reviewOpen = false;
      commitToast(`Override saved for ${game.name || game.appid}`, out.commit);
      reason = "";
      // Clear the form BEFORE reloading, so the leave-guard does not fire on
      // work that has just been committed.
      initial = { ...form };
      retire.clear();
      reload++;
      ongenres();
    } catch (err) {
      reportError(err, "Saving the override failed");
    } finally {
      busy = false;
    }
  }

  async function deleteFile() {
    if (!game || busy) return;
    busy = true;
    try {
      const out = await api<EditResponse>("/api/admin/edit", {
        method: "POST",
        body: { appids: [game.appid], delete: true, reason: reason.trim() },
      });
      deleteOpen = false;
      commitToast("Override file deleted", out.commit, false);
      reload++;
    } catch (err) {
      reportError(err, "Deleting the override file failed");
    } finally {
      busy = false;
    }
  }

  const activeCount = $derived(Object.keys(game?.override?.fields ?? {}).length);
  const retiredCount = $derived(Object.keys(game?.override?.retired ?? {}).length);
</script>

<div class="space-y-5">
  <form class="flex max-w-xl gap-2" onsubmit={load}>
    <div class="relative flex-1">
      <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        bind:value={appidText}
        type="text"
        inputmode="numeric"
        placeholder="Steam appid or store URL"
        aria-label="Steam appid or store URL"
        autocomplete="off"
        disabled={busy}
        class="h-9 w-full rounded-md border border-input bg-background pr-3 pl-8 text-sm placeholder:text-muted-foreground"
      />
    </div>
    <Button type="submit" variant="outline" disabled={busy || !appidText.trim()}>Load</Button>
  </form>

  {#if !appid}
    <div class="rounded-lg border border-border">
      <EmptyState icon={SquarePen} title="Correct a published game">
        Load a game by its appid to change its genre, type, safety or anti-cheat details. The change is saved as an
        override file, which the pipeline re-applies on every run.
      </EmptyState>
    </div>
  {:else if loadError}
    <div class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
      <div>
        <p class="font-medium">Game {appid} could not be loaded.</p>
        <p class="mt-0.5 text-muted-foreground">{loadError}</p>
      </div>
    </div>
  {:else if !game}
    <div class="flex items-center gap-2 py-10 text-sm text-muted-foreground" aria-busy="true">
      <LoaderCircle class="size-4 animate-spin" /> Loading game {appid}…
    </div>
  {:else}
    <div class="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row" class:opacity-60={loading}>
      <Thumb src={game.header_image} lazy={false} class="aspect-[460/215] w-full shrink-0 rounded-md sm:w-60" />
      <div class="min-w-0 flex-1 space-y-2">
        <h2 class="text-xl font-semibold">{game.name || "(no name)"}</h2>
        <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span class="font-mono">{game.appid}</span>
          {#if game.release_date}<span>· {game.release_date}</span>{/if}
          {#if game.status}<Badge variant="outline">{game.status}</Badge>{/if}
          {#if game.is_dead}<Badge variant="destructive">no players</Badge>{/if}
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a class="inline-flex items-center gap-1 text-primary hover:underline" href={steamUrl(game.appid)} target="_blank" rel="noopener noreferrer">
            Steam store <ExternalLink class="size-3.5" />
          </a>
          <a class="inline-flex items-center gap-1 text-primary hover:underline" href="{SITE}/games/{game.appid}" target="_blank" rel="noopener noreferrer">
            Public page <ExternalLink class="size-3.5" />
          </a>
          {#if game.override}
            <a
              class="inline-flex items-center gap-1 text-primary hover:underline"
              href={fileUrl(`data/overrides/${game.appid}.json`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Override file <ExternalLink class="size-3.5" />
            </a>
          {/if}
        </div>
        <p class="text-sm">
          {#if game.override}
            {plural(activeCount, "active override")}{retiredCount ? `, ${retiredCount} retired` : ""}.
          {:else}
            <span class="text-muted-foreground">No override file yet. Saving creates one.</span>
          {/if}
        </p>
      </div>
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      {#each FIELDS as spec (spec.key)}
        {@const active = activeOf(game, spec.key)}
        {@const retired = retiredOf(game, spec.key)}
        {@const changed = changes.includes(spec.key)}
        {@const retiring = retire.has(spec.key)}
        {@const error = errors[spec.key]}
        <div
          class="space-y-2 rounded-lg border p-3 transition-colors
            {spec.kind === 'area' ? 'lg:col-span-2' : ''}
            {error ? 'border-destructive/60' : retiring ? 'border-warning/60 bg-warning/5' : changed ? 'border-primary/60 bg-primary/5' : 'border-border'}"
        >
          <div class="flex flex-wrap items-center gap-2">
            <label for="field-{spec.key}" class="text-sm font-medium">{spec.label}</label>
            {#if active}
              <Badge variant="info" title="Set by {active.set_by ?? 'unknown'} {relativeTime(active.set_at)}">overridden</Badge>
            {:else if retired}
              <Badge variant="secondary">retired</Badge>
            {/if}
            {#if changed}<Badge>changed</Badge>{/if}
            {#if retiring}<Badge variant="warning">will retire</Badge>{/if}
            <span class="ml-auto flex gap-1">
              {#if changed}
                <Button variant="ghost" size="sm" class="h-7" disabled={busy} onclick={() => (form[spec.key] = initial[spec.key])}>
                  Undo
                </Button>
              {/if}
              {#if active}
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7"
                  disabled={busy}
                  title="Stop overriding: restores {showValue(active.was)} on the next pipeline run"
                  onclick={() => {
                    if (retiring) retire.delete(spec.key);
                    else {
                      retire.add(spec.key);
                      form[spec.key] = initial[spec.key];
                    }
                  }}
                >
                  <Undo2 class="size-3.5" />
                  {retiring ? "Keep override" : "Retire"}
                </Button>
              {/if}
            </span>
          </div>

          <FieldEditor
            {spec}
            id="field-{spec.key}"
            bind:value={form[spec.key]}
            current={initial[spec.key]}
            {genres}
            disabled={busy || retiring}
            invalid={!!error}
          />
          {#if error}<p class="text-xs text-destructive">{error}</p>{/if}

          <div class="space-y-0.5 text-xs text-muted-foreground">
            <p>Catalogue now: <span class="break-words text-foreground">{showValue(game.fields[spec.key])}</span></p>
            {#if active}
              <p>
                Override: <span class="text-foreground">{showValue(active.value)}</span> · was
                <span class="text-foreground">{showValue(active.was)}</span>
                {#if active.set_by}· {active.set_by}{/if}
                {#if active.set_at}<span title={exactTime(active.set_at)}> · {relativeTime(active.set_at)}</span>{/if}
              </p>
              {#if active.reason}<p class="break-words">Reason: {active.reason}</p>{/if}
            {:else if retired}
              {@const restored = JSON.stringify(game.fields[spec.key] ?? null) !== JSON.stringify(retired.value ?? null)}
              <p>
                Retired{retired.retired_by ? ` by ${retired.retired_by}` : ""}{retired.retired_at ? ` ${relativeTime(retired.retired_at)}` : ""}:
                restores <span class="text-foreground">{showValue(retired.was)}</span> ·
                {restored ? "done" : "waiting for the pipeline"}
              </p>
            {/if}
            {#if spec.hint && !active && !retired}<p>{spec.hint}</p>{/if}
          </div>
        </div>
      {/each}
    </div>

    {#if game.override}
      <div class="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
        <Trash2 class="size-4 text-muted-foreground" />
        {#if game.deletable.ok}
          <p class="flex-1">Every entry in the override file is retired and restored, so the file can be deleted.</p>
          <Button variant="outline" size="sm" class="text-destructive" disabled={busy || dirty} onclick={() => (deleteOpen = true)}>
            Delete override file
          </Button>
        {:else}
          <p class="flex-1 text-muted-foreground">The override file cannot be deleted yet: {game.deletable.reason}.</p>
        {/if}
      </div>
    {/if}

    <p class="flex items-start gap-2 text-xs text-muted-foreground">
      <Info class="mt-0.5 size-3.5 shrink-0" />
      <span>
        Saving writes data/overrides/{game.appid}.json and nothing else. data/ changes on the next pipeline run. A field
        cannot be saved empty, because the next scrape would refill it; retire the override instead.
      </span>
    </p>
  {/if}
</div>

{#if dirty && game}
  <div class="pointer-events-none sticky bottom-4 z-20 mt-4 flex justify-center">
    <div
      class="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-border-strong bg-card/95 px-3 py-2 shadow-xl backdrop-blur"
    >
      <span class="px-1 text-sm font-medium">{plural(changes.length + retire.size, "change")}</span>
      <input
        bind:value={reason}
        type="text"
        maxlength="300"
        placeholder="Reason (kept in the commit and the file)"
        aria-label="Reason for the change"
        disabled={busy}
        class="h-8 min-w-48 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground"
      />
      <Button variant="ghost" size="sm" onclick={discard} disabled={busy}>Discard</Button>
      <Button size="sm" onclick={() => (reviewOpen = true)} disabled={busy || invalid}>Review and save</Button>
    </div>
  </div>
{/if}

<Dialog
  bind:open={reviewOpen}
  title="Save {plural(plan.length, 'change')} to {game?.name || appid}?"
  description="One commit to data/overrides/{appid}.json. data/ is untouched until the pipeline runs."
  size="lg"
  dismissable={!busy}
>
  <div class="overflow-x-auto rounded-md border border-border">
    <table class="w-full text-sm">
      <thead class="bg-muted/50 text-left text-xs text-muted-foreground">
        <tr>
          <th class="px-3 py-2">Field</th>
          <th class="px-3 py-2">Catalogue now</th>
          <th class="px-3 py-2">Override now</th>
          <th class="px-3 py-2">After saving</th>
        </tr>
      </thead>
      <tbody>
        {#each plan as row (row.field)}
          <tr class="border-t border-border align-top">
            <td class="px-3 py-2 font-medium whitespace-nowrap">{FIELD_LABEL[row.field]}</td>
            <td class="px-3 py-2 break-words">{showValue(row.catalogue)}</td>
            <td class="px-3 py-2 break-words text-muted-foreground">
              {row.active ? `${showValue(row.active.value)} (was ${showValue(row.active.was)})` : "none"}
            </td>
            <td class="px-3 py-2 break-words">
              {#if row.kind === "retire"}
                <span class="text-warning">retire</span>: restores {showValue(row.next)} once
              {:else}
                <span class="font-medium text-primary">{showValue(row.next)}</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="mt-3 text-sm">
    Reason: <span class={reason.trim() ? "" : "text-muted-foreground"}>{reason.trim() || "none given"}</span>
  </p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (reviewOpen = false)} disabled={busy}>Back</Button>
    <Button onclick={save} disabled={busy || invalid}>
      {#if busy}<LoaderCircle class="size-4 animate-spin" />{/if}
      Commit override
    </Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={deleteOpen}
  title="Delete the override file?"
  description="Removes data/overrides/{appid}.json in one commit. Every entry in it has already done its job."
  size="sm"
  dismissable={!busy}
>
  <p class="text-sm text-muted-foreground">
    The server checks the file again at commit time and refuses if anything in it is still active.
  </p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (deleteOpen = false)} disabled={busy}>Cancel</Button>
    <Button variant="destructive" onclick={deleteFile} disabled={busy}>
      {#if busy}<LoaderCircle class="size-4 animate-spin" />{/if}
      Delete file
    </Button>
  {/snippet}
</Dialog>
