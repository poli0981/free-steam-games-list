<script lang="ts">
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { bucketByAntiCheat } from "$lib/anti-cheat";
  import { appidOf } from "$lib/data-store";
  import { formatNumber, parseIntSafe } from "$lib/utils";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import Badge from "$lib/ui/Badge.svelte";

  const t = i18n.t;

  const buckets = $derived(
    bucketByAntiCheat(games.data?.records ?? []).map((b) => ({
      ...b,
      // Biggest audience first inside each product: an anti-cheat's reputation
      // is set by the games people actually play with it.
      games: [...b.games].sort(
        (a, c) => parseIntSafe(c.current_players) - parseIntSafe(a.current_players),
      ),
    })),
  );
</script>

<svelte:head>
  <title>{t("antiCheatList.title")} · Steam F2P Tracker</title>
  <meta name="description" content={t("antiCheatList.subtitle")} />
</svelte:head>

<PageHeader title={t("antiCheatList.title")} subtitle={t("antiCheatList.subtitle")} />

<QueryState loading={games.loading && !games.data} error={games.error} retry={() => games.refetch()}>
  <div class="space-y-4">
    {#each buckets as bucket (bucket.key)}
      {@const kernel = bucket.games.some((g) => g.is_kernel_ac === true)}
      <section class="rounded-lg border bg-card">
        <header class="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <h2 class="font-display text-base font-semibold">{bucket.key}</h2>
          {#if kernel}
            <Badge variant="destructive">{t("charts.acLevel.kernel")}</Badge>
          {/if}
          <span class="ml-auto text-xs text-muted-foreground tnum">
            {formatNumber(bucket.games.length)}
          </span>
        </header>

        <ul class="divide-y">
          {#each bucket.games.slice(0, 12) as g (g.link)}
            {@const appid = appidOf(g)}
            <li>
              <a
                href={appid ? `/games/${appid}` : g.link}
                class="flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-accent"
              >
                <span class="min-w-0 flex-1 truncate">{g.name}</span>
                {#if g.genre}
                  <Badge variant="outline">{g.genre}</Badge>
                {/if}
                <span class="w-20 shrink-0 text-right font-mono text-xs text-muted-foreground tnum">
                  {formatNumber(g.current_players)}
                </span>
              </a>
            </li>
          {/each}
        </ul>

        {#if bucket.games.length > 12}
          <p class="border-t px-4 py-2 text-xs text-muted-foreground">
            {t("games.showing", {
              shown: 12,
              total: formatNumber(bucket.games.length),
            })}
          </p>
        {/if}
      </section>
    {/each}
  </div>
</QueryState>
