<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import { page } from "$app/state";
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { appidOf } from "$lib/data-store";
  import { headerToCapsule } from "$lib/image";
  import { formatNumber, parseReviewPercent } from "$lib/utils";
  import { reviewTone } from "$lib/games/columns";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import Badge from "$lib/ui/Badge.svelte";

  const t = i18n.t;

  const name = $derived(decodeURIComponent(page.params.name ?? ""));
  const titles = $derived(
    (games.data?.records ?? []).filter((r) => (r.publisher ?? []).includes(name)),
  );
</script>

<svelte:head>
  <title>{name} · Steam F2P Tracker</title>
  <meta name="description" content={t("studios.gamesCount", { count: titles.length })} />
  <!-- One page per studio name is generated on demand from the catalogue, not
       prerendered: there are thousands, and most have a single game. -->
  <meta name="robots" content="index, follow" />
</svelte:head>

<a
  href="/publishers"
  class="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
>
  <ArrowLeft class="size-3.5" />
  {t("studios.backToList")}
</a>

<QueryState loading={games.loading && !games.data} error={games.error} retry={() => games.refetch()}>
  {#if !titles.length}
    <p class="py-16 text-center text-sm text-muted-foreground">{t("studios.notFound")}</p>
  {:else}
    <PageHeader
      title={name}
      subtitle={titles.length === 1
        ? t("studios.oneGame")
        : t("studios.gamesCount", { count: formatNumber(titles.length) })}
    />

    <ul class="divide-y rounded-lg border bg-card">
      {#each titles as g (g.link)}
        {@const appid = appidOf(g)}
        {@const pct = parseReviewPercent(g.reviews)}
        <li>
          <a
            href={appid ? `/games/${appid}` : g.link}
            class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent"
          >
            {#if g.header_image}
              <img
                src={headerToCapsule(g.header_image)}
                alt=""
                loading="lazy"
                decoding="async"
                class="h-8 w-[68px] shrink-0 rounded object-cover"
              />
            {/if}
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span>
            {#if g.genre}<Badge variant="outline">{g.genre}</Badge>{/if}
            {#if pct !== null}
              <span class="w-12 shrink-0 text-right font-mono text-xs tnum {reviewTone(pct)}">{pct}%</span>
            {/if}
            <span class="w-20 shrink-0 text-right font-mono text-xs text-muted-foreground tnum">
              {formatNumber(g.current_players)}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</QueryState>
