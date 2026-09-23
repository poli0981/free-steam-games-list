<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Monitor from "@lucide/svelte/icons/monitor";
  import { page } from "$app/state";
  import { games, removedGames } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { preferWebp, socialImagePath } from "$lib/image";
  import { steamWebUrl, steamProtocolUrl } from "$lib/steam-link";
  import { isAndroid } from "$lib/external-open";
  import {
    formatNumber,
    formatRelativeDate,
    parseReleaseDate,
    parseReviewPercent,
    reviewLabel,
  } from "$lib/utils";
  import { reviewTone } from "$lib/games/columns";
  import { extractAppid } from "$lib/data-store";
  import { seedScript, toSeed, type GameSeed } from "$lib/game-seed";
  import { markRouteRendered } from "$lib/fallback-route";
  import { SITE_ORIGIN } from "$lib/site";
  import QueryState from "$lib/common/QueryState.svelte";
  import Badge from "$lib/ui/Badge.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Seo from "$lib/common/Seo.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // This page, not the dashboard shell, is what hydrated (lib/fallback-route.ts).
  markRouteRendered("/games/[appid]");

  const t = i18n.t;

  const appid = $derived(page.params.appid ?? "");

  /** The record in the live catalogue, once it has loaded. O(1) by appid. */
  const live = $derived.by(() => {
    const catalogue = games.data;
    if (!catalogue) return undefined;
    const i = catalogue.appidIndex.get(appid);
    return i === undefined ? undefined : catalogue.records[i];
  });

  /**
   * What the page renders its slow-changing fields from.
   *
   * The live record when there is one - it is newer than any build. Otherwise
   * the seed this page was prerendered with, which is all a crawler or a
   * visitor who has not accepted the terms will ever have.
   */
  const seed = $derived(data.seed && data.seed.appid === appid ? data.seed : null);
  const view: GameSeed | null = $derived(live ? toSeed(live) : seed);

  /** The catalogue loaded and this game is not in it: delisted, removed, or a
   *  page prerendered before it left. */
  const missing = $derived(Boolean(games.data) && !live);

  $effect(() => {
    if (missing) void removedGames.load();
  });
  const removal = $derived(
    missing
      ? removedGames.data?.find((r) => (r.appid || extractAppid(r.link)) === appid)
      : undefined,
  );

  // Volatile: only ever from the live catalogue, never from a build.
  const pct = $derived(live ? parseReviewPercent(live.reviews) : null);
  const reviewWording = $derived(live ? reviewLabel(live.reviews) : null);

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

  interface Row {
    /** A literal i18n key: i18n.test.ts rejects `detail.${key}`, which is how
     *  the "(peak {{peak}})" suffix once rendered as a field label. */
    label: string;
    text?: string;
    /** Studio names, each linking to its own page. */
    links?: { name: string; href: string }[];
  }

  const studioLinks = (names: string[], base: string) =>
    names.map((name) => ({ name, href: `${base}/${encodeURIComponent(name)}` }));

  const rows = $derived.by((): Row[] => {
    if (!view) return [];
    const players = live?.current_players
      ? live.peak_today
        ? `${formatNumber(live.current_players)} ${t("detail.playersPeak", { peak: formatNumber(live.peak_today) })}`
        : formatNumber(live.current_players)
      : undefined;
    const all: Row[] = [
      { label: "detail.labelGenre", text: view.genre },
      { label: "detail.labelType", text: view.type_game },
      { label: "detail.labelDeveloper", links: studioLinks(view.developer, "/developers") },
      { label: "detail.labelPublisher", links: studioLinks(view.publisher, "/publishers") },
      { label: "detail.labelReleased", text: view.release_date },
      { label: "detail.labelPlatforms", text: view.platforms.join(", ") },
      { label: "detail.labelPlayers", text: players },
      { label: "detail.labelAntiCheat", text: view.anti_cheat },
      { label: "detail.labelMetacritic", text: live?.metacritic },
      { label: "detail.labelDrm", text: view.drm_notes },
      { label: "detail.labelStatus", text: view.status },
      { label: "detail.labelLastUpdated", text: live?.last_updated ? formatRelativeDate(live.last_updated) : undefined },
    ];
    return all.filter((r) => (r.links ? r.links.length > 0 : Boolean(r.text)));
  });

  /** A calendar date from Steam's "Aug 10, 2023", without a timezone shift. */
  function isoDate(release: string): string | undefined {
    const ms = parseReleaseDate(release);
    if (!Number.isFinite(ms)) return undefined;
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const socialImage = $derived(view ? socialImagePath(view.header_image) : null);

  /** schema.org VideoGame. No rating: review scores are volatile, and a baked
   *  one would be stale by the next data commit. */
  const jsonld = $derived.by(() => {
    if (!view || missing) return undefined;
    const released = isoDate(view.release_date);
    const org = (name: string) => ({ "@type": "Organization", name });
    return {
      "@context": "https://schema.org",
      "@type": "VideoGame",
      name: view.name,
      url: `${SITE_ORIGIN}/games/${view.appid}`,
      sameAs: steamWebUrl(view.appid),
      ...(view.description ? { description: view.description } : {}),
      ...(socialImage ? { image: SITE_ORIGIN + socialImage } : {}),
      ...(view.genre ? { genre: view.genre } : {}),
      ...(view.platforms.length ? { gamePlatform: view.platforms } : {}),
      ...(view.developer.length ? { author: view.developer.map(org) } : {}),
      ...(view.publisher.length ? { publisher: view.publisher.map(org) } : {}),
      ...(released ? { datePublished: released } : {}),
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", url: steamWebUrl(view.appid) },
    };
  });
</script>

<Seo
  title={view?.name ?? (missing ? t("dialogs.gameNotFound") : t("nav.games"))}
  description={view ? view.description || view.name : t("dialogs.gameNotFoundBody", { appid })}
  type="article"
  image={socialImage ?? undefined}
  imageWidth={socialImage ? null : undefined}
  imageHeight={socialImage ? null : undefined}
  noindex={missing}
  {jsonld}
/>

<!-- The build-time seed, read back by this route's load() while hydrating.
     Only present on a prerendered page; see lib/game-seed.ts. -->
{#if data.seed}
  {@html seedScript(data.seed)}
{/if}

<a
  href="/games"
  class="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
>
  <ArrowLeft class="size-3.5" />
  {t("nav.games")}
</a>

{#if missing}
  <div class="py-16 text-center">
    <h1 class="font-display text-xl font-semibold">{t("dialogs.gameNotFound")}</h1>
    <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
      {t("dialogs.gameNotFoundBody", { appid })}
    </p>
    {#if removal}
      <p class="mx-auto mt-3 max-w-md text-sm">
        {t("detail.removedOn", {
          date: (removal.removed_at ?? "").slice(0, 10),
          reason: removal.reason || removal.status_code,
        })}
      </p>
    {/if}
  </div>
{:else if view}
  <article class="max-w-3xl">
    {#if view.header_image}
      <img
        src={preferWebp(view.header_image, 920)}
        alt=""
        referrerpolicy="no-referrer"
        class="mb-5 w-full rounded-lg border object-cover"
        width="920"
        height="430"
      />
    {/if}

    <div class="flex flex-wrap items-start gap-3">
      <h1 class="min-w-0 flex-1 text-2xl font-semibold tracking-tight sm:text-3xl">
        {#if view.is_dead}<span title={t("games.deadTitle")}>💀</span>{/if}
        {view.name}
      </h1>
      {#if pct !== null}
        <!-- The score alone ("32%") said nothing about what it measures;
             Steam's own wording travels with it. -->
        <div class="text-right" title={t("detail.labelReviews")}>
          <span class="font-mono text-xl font-semibold tnum {reviewTone(pct)}">{pct}%</span>
          {#if reviewWording}
            <span class="block text-xs text-muted-foreground">{reviewWording}</span>
          {/if}
        </div>
      {/if}
    </div>

    <div class="mt-2 flex flex-wrap gap-1.5">
      {#if view.genre}<Badge variant="outline">{view.genre}</Badge>{/if}
      {#if view.type_game}
        <Badge variant={view.type_game === "online" ? "success" : "secondary"}>
          {t(view.type_game === "online" ? "common.online" : "common.offline")}
        </Badge>
      {/if}
      {#if view.anti_cheat && view.anti_cheat !== "-"}
        <Badge variant={view.is_kernel_ac ? "destructive" : "warning"}>{view.anti_cheat}</Badge>
      {/if}
      {#if view.has_paid_dlc}<Badge variant="warning">{t("detail.labelHasPaidDlc")}</Badge>{/if}
    </div>

    {#if view.description}
      <p class="mt-4 text-sm leading-relaxed text-muted-foreground">{view.description}</p>
      <p class="mt-1 text-xs text-muted-foreground">{t("detail.descriptionSource")}</p>
    {/if}

    <div class="mt-5 flex flex-wrap gap-2">
      <Button href={steamWebUrl(view.appid)} target="_blank" rel="noreferrer">
        <ExternalLink class="size-4" />
        {t("detail.openOnSteamWeb")}
      </Button>
      {#if !narrow}
        <Button variant="outline" href={steamProtocolUrl(view.appid)} title={t("detail.openOnSteamDesktopHint")}>
          <Monitor class="size-4" />
          {t("detail.openOnSteamDesktop")}
        </Button>
      {/if}
    </div>

    <dl class="mt-6 grid gap-x-6 gap-y-3 rounded-lg border bg-card p-5 sm:grid-cols-2">
      {#each rows as row (row.label)}
        <div class="min-w-0">
          <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(row.label)}
          </dt>
          <dd class="mt-0.5 truncate text-sm">
            {#if row.links}
              {#each row.links as studio, i (studio.name)}
                {#if i > 0}<span class="text-muted-foreground">, </span>{/if}
                <a href={studio.href} class="hover:text-primary hover:underline">{studio.name}</a>
              {/each}
            {:else}
              {row.text}
            {/if}
          </dd>
        </div>
      {/each}
    </dl>

    {#if view.tags.length}
      <section class="mt-5">
        <h2 class="mb-2 text-sm font-semibold">{t("detail.labelTags")}</h2>
        <div class="flex flex-wrap gap-1.5">
          {#each view.tags as tag (tag)}<Badge variant="secondary">{tag}</Badge>{/each}
        </div>
      </section>
    {/if}

    {#if view.languages.length}
      <section class="mt-5">
        <h2 class="mb-2 text-sm font-semibold">
          {t("detail.labelLanguages", { count: view.languages.length })}
        </h2>
        <p class="text-sm text-muted-foreground">{view.languages.join(", ")}</p>
      </section>
    {/if}

    {#if view.notes}
      <section class="mt-5 rounded-lg border border-warning/30 bg-warning/5 p-4">
        <h2 class="mb-1 text-sm font-semibold">{t("detail.labelNotes")}</h2>
        <p class="whitespace-pre-wrap text-sm text-muted-foreground">{view.notes}</p>
      </section>
    {/if}
  </article>
{:else}
  <!-- No seed (not a prerendered page) and no catalogue yet. -->
  <QueryState loading={games.pending} error={games.error} retry={() => games.refetch()}>
    <div></div>
  </QueryState>
{/if}
