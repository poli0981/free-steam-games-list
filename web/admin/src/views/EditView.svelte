<script lang="ts">
  import { untrack } from "svelte";
  import EditGame from "./EditGame.svelte";
  import BulkEdit from "./BulkEdit.svelte";
  import { api, SessionExpiredError } from "../lib/api";
  import { reportError } from "../lib/notify";
  import { router } from "../lib/router.svelte";
  import type { GenresResponse } from "../../../shared/admin-api";

  const mode = $derived(router.query.get("mode") === "bulk" ? "bulk" : "one");

  /** One flag for the whole page: while a commit runs, nothing else may start. */
  let busy = $state(false);
  let genres = $state.raw<GenresResponse["genres"]>([]);
  let genresError = $state<string | null>(null);
  let genresToken = $state(0);

  $effect(() => {
    void genresToken;
    const controller = new AbortController();
    untrack(() => (genresError = null));
    api<GenresResponse>("genres", { signal: controller.signal })
      .then((out) => (genres = out.genres))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof SessionExpiredError) reportError(err);
        genresError = err instanceof Error ? err.message : String(err);
      });
    return () => controller.abort();
  });

  function setMode(next: "one" | "bulk") {
    if (busy || next === mode || !router.confirmLeave()) return;
    router.setQuery(next === "bulk" ? { mode: "bulk", appid: null } : { mode: null, genre: null, page: null });
  }
</script>

<section class="space-y-5">
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">Correct published games</h1>
    <p class="text-sm text-muted-foreground">
      Human corrections to genre, type, safety and anti-cheat, saved as override files that survive every pipeline run.
    </p>
  </div>

  <div role="tablist" aria-label="Edit mode" class="inline-flex rounded-lg border border-border bg-muted/40 p-1">
    {#each [{ id: "one", label: "One game" }, { id: "bulk", label: "Several games" }] as tab (tab.id)}
      <button
        type="button"
        role="tab"
        aria-selected={mode === tab.id}
        disabled={busy}
        class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50
          {mode === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => setMode(tab.id as "one" | "bulk")}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#if genresError}
    <p class="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      The genre list could not be loaded ({genresError}). Genre suggestions and the bulk picker are unavailable.
      <button type="button" class="font-medium text-primary hover:underline" onclick={() => genresToken++}>Try again</button>
    </p>
  {/if}

  {#if mode === "one"}
    <EditGame {genres} bind:busy ongenres={() => genresToken++} />
  {:else}
    <BulkEdit {genres} bind:busy ongenres={() => genresToken++} />
  {/if}
</section>
