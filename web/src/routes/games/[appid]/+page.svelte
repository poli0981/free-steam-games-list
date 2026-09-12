<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Monitor from "@lucide/svelte/icons/monitor";
  import { page } from "$app/state";
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { preferWebp } from "$lib/image";
  import { steamWebUrl, steamProtocolUrl } from "$lib/steam-link";
  import { isAndroid } from "$lib/external-open";
  import { formatNumber, parseReviewPercent, formatRelativeDate } from "$lib/utils";
  import { reviewTone } from "$lib/games/columns";
  import QueryState from "$lib/common/QueryState.svelte";
  import Badge from "$lib/ui/Badge.svelte";
  import Button from "$lib/ui/Button.svelte";

  const t = i18n.t;

  const appid = $derived(page.params.appid ?? "");

  // O(1) through the prebuilt index rather than scanning 3,700 records.
  const game = $derived.by(() => {
    const data = games.data;
    if (!data) return undefined;
    const i = data.appidIndex.get(appid);
    return i === undefined ? undefined : data.records[i];
  });

  const pct = $derived(game ? parseReviewPercent(game.reviews) : null);

  // The steam:// button cannot reach a client on a phone, so it is hidden on
  // Android and on narrow viewports. matchMedia rather than a CSS class, so the
  // button is genuinely absent instead of invisible-but-focusable.
  let narrow = $state(false);
  $effect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => (narrow = mq.matches || isAndroid());
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  });

  const FIELDS = [
    { key: "labelGenre", get: (g: NonNullable<typeof game>) => g.genre },
    { key: "labelType", get: (g: NonNullable<typeof game>) => g.type_game },
    { key: "labelDeveloper", get: (g: NonNullable<typeof game>) => (g.developer ?? []).join(", ") },
    { key: "labelPublisher", get: (g: NonNullable<typeof game>) => (g.publisher ?? []).join(", ") },
    { key: "labelReleased", get: (g: NonNullable<typeof game>) => g.release_date },
    { key: "labelPlatforms", get: (g: NonNullable<typeof game>) => (g.platforms ?? []).join(", ") },
    { key: "labelPlayers", get: (g: NonNullable<typeof game>) => formatNumber(g.current_players) },
    { key: "playersPeak", get: (g: NonNullable<typeof game>) => formatNumber(g.peak_today) },
    { key: "labelAntiCheat", get: (g: NonNullable<typeof game>) => g.anti_cheat },
    { key: "labelMetacritic", get: (g: NonNullable<typeof game>) => g.metacritic },
    { key: "labelDrm", get: (g: NonNullable<typeof game>) => g.drm_notes },
    { key: "labelStatus", get: (g: NonNullable<typeof game>) => g.status },
  ];
</script>

<svelte:head>
  <title>{game ? `${game.name} · Steam F2P Tracker` : "Steam F2P Tracker"}</title>
  {#if game}
    <meta name="description" content={game.description || game.name} />
    <link rel="canonical" href={`https://free-steam-games.win/games/${appid}`} />
  {/if}
</svelte:head>

<a
  href="/games"
  class="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
>
  <ArrowLeft class="size-3.5" />
  {t("nav.games")}
</a>

<QueryState loading={games.loading && !games.data} error={games.error} retry={() => games.refetch()}>
  {#if !game}
    <p class="py-16 text-center text-sm text-muted-foreground">{t("errors.404.description")}</p>
  {:else}
    <article class="max-w-3xl">
      {#if game.header_image}
        <img
          src={preferWebp(game.header_image, 920)}
          alt=""
          class="mb-5 w-full rounded-lg border object-cover"
          width="920"
          height="430"
        />
      {/if}

      <div class="flex flex-wrap items-start gap-3">
        <h1 class="min-w-0 flex-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {#if game.is_dead}<span title={t("games.deadTitle")}>💀</span>{/if}
          {game.name}
        </h1>
        {#if pct !== null}
          <span class="font-mono text-xl font-semibold tnum {reviewTone(pct)}">{pct}%</span>
        {/if}
      </div>

      <div class="mt-2 flex flex-wrap gap-1.5">
        {#if game.genre}<Badge variant="outline">{game.genre}</Badge>{/if}
        {#if game.type_game}
          <Badge variant={game.type_game === "online" ? "success" : "secondary"}>
            {t(game.type_game === "online" ? "common.online" : "common.offline")}
          </Badge>
        {/if}
        {#if game.anti_cheat && game.anti_cheat !== "-"}
          <Badge variant={game.is_kernel_ac ? "destructive" : "warning"}>{game.anti_cheat}</Badge>
        {/if}
        {#if game.has_paid_dlc}<Badge variant="warning">{t("detail.labelHasPaidDlc")}</Badge>{/if}
      </div>

      {#if game.description}
        <p class="mt-4 text-sm leading-relaxed text-muted-foreground">{game.description}</p>
        <p class="mt-1 text-xs text-muted-foreground">{t("detail.descriptionSource")}</p>
      {/if}

      <div class="mt-5 flex flex-wrap gap-2">
        <Button href={steamWebUrl(appid)} target="_blank" rel="noreferrer">
          <ExternalLink class="size-4" />
          {t("detail.openOnSteamWeb")}
        </Button>
        {#if !narrow}
          <Button variant="outline" href={steamProtocolUrl(appid)} title={t("detail.openOnSteamDesktopHint")}>
            <Monitor class="size-4" />
            {t("detail.openOnSteamDesktop")}
          </Button>
        {/if}
      </div>

      <dl class="mt-6 grid gap-x-6 gap-y-3 rounded-lg border bg-card p-5 sm:grid-cols-2">
        {#each FIELDS as f (f.key)}
          {@const value = f.get(game)}
          {#if value}
            <div class="min-w-0">
              <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(`detail.${f.key}`)}
              </dt>
              <dd class="mt-0.5 truncate text-sm">{value}</dd>
            </div>
          {/if}
        {/each}
        <div class="min-w-0">
          <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("detail.labelLastUpdated")}
          </dt>
          <dd class="mt-0.5 truncate text-sm">{formatRelativeDate(game.last_updated)}</dd>
        </div>
      </dl>

      {#if game.tags?.length}
        <section class="mt-5">
          <h2 class="mb-2 text-sm font-semibold">{t("detail.labelTags")}</h2>
          <div class="flex flex-wrap gap-1.5">
            {#each game.tags as tag (tag)}<Badge variant="secondary">{tag}</Badge>{/each}
          </div>
        </section>
      {/if}

      {#if game.languages?.length}
        <section class="mt-5">
          <h2 class="mb-2 text-sm font-semibold">{t("detail.labelLanguages")}</h2>
          <p class="text-sm text-muted-foreground">{game.languages.slice(0, 30).join(", ")}</p>
        </section>
      {/if}

      {#if game.notes}
        <section class="mt-5 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <h2 class="mb-1 text-sm font-semibold">{t("detail.labelNotes")}</h2>
          <p class="whitespace-pre-wrap text-sm text-muted-foreground">{game.notes}</p>
        </section>
      {/if}
    </article>
  {/if}
</QueryState>
