<!--
  Catalogue records that fail a check (shared/quality.ts): the counts, then one
  check's games with links to fix them. Fixes go through the Edit page as
  overrides; scraped fields are refilled by Refresh Store Data on its own.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Button from "../../../src/lib/ui/Button.svelte";
  import Pager from "../components/Pager.svelte";
  import Thumb from "../components/Thumb.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { isAbort, reportError } from "../lib/notify";
  import { router } from "../lib/router.svelte";
  import { formatInt, steamUrl } from "../lib/format";
  import { isQualityCheck, QUALITY_CHECKS, QUALITY_GROUPS, type QualityCheck } from "../../../shared/quality";
  import type { QualityListResponse, QualitySummaryResponse } from "../../../shared/admin-api";

  const SIZES = [25, 50, 100, 200];
  const query = $derived(router.query);
  const check = $derived.by((): QualityCheck | null => {
    const c = query.get("check");
    return isQualityCheck(c) ? c : null;
  });
  const size = $derived(SIZES.includes(Number(query.get("size"))) ? Number(query.get("size")) : 50);
  const page = $derived(Math.max(1, Math.floor(Number(query.get("page"))) || 1));
  const spec = $derived(QUALITY_CHECKS.find((c) => c.key === check) ?? null);

  let summary = $state.raw<QualitySummaryResponse | null>(null);
  let list = $state.raw<QualityListResponse | null>(null);
  let loadError = $state<string | null>(null);
  let loading = $state(true);

  $effect(() => {
    const c = check;
    const params = new URLSearchParams(c ? { check: c, limit: String(size), offset: String((page - 1) * size) } : {});
    const controller = new AbortController();
    untrack(() => {
      loading = true;
      loadError = null;
    });
    const request = c
      ? api<QualityListResponse>(`quality?${params}`, { signal: controller.signal }).then((r) => (list = r))
      : api<QualitySummaryResponse>("quality", { signal: controller.signal }).then((r) => (summary = r));
    request
      .then(() => (loading = false))
      .catch((err) => {
        if (isAbort(err)) return;
        loading = false;
        loadError = errorMessage(err);
        if (err instanceof SessionExpiredError) reportError(err);
      });
    return () => controller.abort();
  });
</script>

<section class="space-y-5">
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">Data quality</h1>
    <p class="max-w-3xl text-sm text-muted-foreground">
      Published games with something missing or unreviewed. Judgements and manual fields are fixed on the Edit page (as
      overrides); store fields are retried by Refresh Store Data on its own.
    </p>
  </div>

  {#if loadError}
    <div class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" /> <p>{loadError}</p>
    </div>
  {:else if !check}
    {#if !summary}
      <p class="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Reading the catalogue…</p>
    {:else}
      <p class="text-sm text-muted-foreground">{formatInt(summary.total)} games checked.</p>
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {#each QUALITY_GROUPS as group (group.key)}
          <article class="space-y-2 rounded-lg border border-border bg-card p-4">
            <h2 class="font-semibold">{group.label}</h2>
            <ul class="divide-y divide-border">
              {#each QUALITY_CHECKS.filter((c) => c.group === group.key) as c (c.key)}
                {@const n = summary.counts[c.key] ?? 0}
                <li class="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <div class="min-w-0">
                    <p class={n ? "" : "text-muted-foreground"}>{c.label}</p>
                    <p class="text-xs text-muted-foreground">{c.hint}</p>
                  </div>
                  {#if n}
                    <a href="/admin/quality?check={c.key}" class="tnum shrink-0 font-medium text-primary hover:underline">{formatInt(n)}</a>
                  {:else}
                    <span class="tnum shrink-0 text-muted-foreground">0</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </article>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="flex flex-wrap items-center gap-3">
      <Button variant="ghost" size="sm" href="/admin/quality"><ArrowLeft class="size-4" /> All checks</Button>
      <h2 class="font-semibold">{spec?.label}</h2>
      <span class="text-sm text-muted-foreground">{spec?.hint}</span>
    </div>
    {#if loading && !list}
      <p class="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Loading…</p>
    {:else if list && !list.items.length}
      <div class="rounded-lg border border-border"><EmptyState icon={ListChecks} title="Nothing here">No published game fails this check.</EmptyState></div>
    {:else if list}
      <div class="relative overflow-x-auto rounded-lg border border-border" class:opacity-60={loading}>
        <table class="w-full text-sm">
          <thead class="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th class="px-3 py-2 font-medium">Game</th>
              <th class="hidden px-3 py-2 font-medium sm:table-cell">Genre</th>
              <th class="hidden px-3 py-2 font-medium sm:table-cell">Type</th>
              <th class="px-3 py-2"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {#each list.items as g (g.appid)}
              <tr class="border-t border-border">
                <td class="px-3 py-2">
                  <div class="flex items-center gap-3">
                    <Thumb src={g.header_image} class="h-8 w-16 shrink-0" />
                    <div class="min-w-0">
                      <p class="max-w-72 truncate">{g.name || "(no name)"}</p>
                      <p class="font-mono text-xs text-muted-foreground">{g.appid}</p>
                    </div>
                  </div>
                </td>
                <td class="hidden px-3 py-2 sm:table-cell">{g.genre || "—"}</td>
                <td class="hidden px-3 py-2 sm:table-cell">{g.type_game || "—"}</td>
                <td class="px-3 py-2">
                  <div class="flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" href="/admin/edit?appid={g.appid}">Edit</Button>
                    <a class="text-muted-foreground hover:text-foreground" href={steamUrl(g.appid)} target="_blank" rel="noopener noreferrer" title="Steam store">
                      <ExternalLink class="size-4" />
                    </a>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pager
        offset={list.offset}
        limit={list.limit}
        total={list.total}
        count={list.items.length}
        sizes={SIZES}
        disabled={loading}
        onpage={(o) => router.setQuery({ page: o / size + 1 === 1 ? null : o / size + 1 })}
        onsize={(n) => router.setQuery({ size: n === 50 ? null : n, page: null })}
      />
    {/if}
  {/if}
</section>
