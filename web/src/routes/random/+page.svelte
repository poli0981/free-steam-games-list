<script lang="ts">
  import { untrack } from "svelte";
  import Dices from "@lucide/svelte/icons/dices";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { games } from "#lib/games.svelte.js";
  import { i18n } from "#lib/i18n.svelte.js";
  import { randomPicks } from "#lib/random.svelte.js";
  import { PICK_COUNTS, buildPool, type TypeChoice } from "#lib/random-pick.js";
  import { heroFallback, heroImage } from "#lib/image.js";
  import { imgFallback } from "#lib/img-fallback.js";
  import { steamWebUrl } from "#lib/steam-link.js";
  import { cn, formatNumber, parseReviewPercent, reviewLabel } from "#lib/utils.js";
  import { reviewTone } from "#lib/games/columns.js";
  import QueryState from "#lib/common/QueryState.svelte";
  import PageHeader from "#lib/common/PageHeader.svelte";
  import Seo from "#lib/common/Seo.svelte";
  import Badge from "#lib/ui/Badge.svelte";
  import Button from "#lib/ui/Button.svelte";

  const t = i18n.t;

  const TYPES: { value: TypeChoice; label: string }[] = [
    { value: "any", label: "common.all" },
    { value: "online", label: "charts.kpi.online" },
    { value: "offline", label: "charts.kpi.offline" },
  ];

  const pool = $derived(games.data ? buildPool(games.data, randomPicks.options) : []);
  const picks = $derived(games.data ? randomPicks.resolve(games.data) : []);

  // The first roll, as soon as the catalogue is here. untrack: a revalidation
  // (a new games.data), coming Back to this page or switching the language
  // must never roll again - only the reader does that.
  $effect(() => {
    const data = games.data;
    if (data) untrack(() => randomPicks.rollOnce(data));
  });

  // Read out after every change the reader makes. The first roll is not: it
  // arrives together with the page.
  let announcement = $state("");

  function announce() {
    if (!games.data) return;
    const shown = randomPicks.resolve(games.data);
    const names = shown.map((p) => p.record.name).join(", ");
    announcement = shown.length ? t("random.announce", { count: shown.length, names }) : t("random.noMatch");
  }

  function roll() {
    if (!games.data) return;
    randomPicks.roll(games.data);
    announce();
  }

  function changeCount(n: number) {
    randomPicks.setCount(n, games.data);
    announce();
  }

  function changeType(type: TypeChoice) {
    randomPicks.setType(type, games.data);
    announce();
  }

  function changeDead(on: boolean) {
    randomPicks.setIncludeDead(on, games.data);
    announce();
  }

  function choice(selected: boolean) {
    return cn(
      "rounded-md border px-3 py-1.5 text-sm transition-colors",
      selected ? "border-primary/50 bg-primary/10" : "hover:border-border-strong hover:bg-accent",
    );
  }
</script>

<Seo title={t("nav.random")} description={t("random.seoDescription")} />

<PageHeader title={t("nav.random")} subtitle={t("random.subtitle")}>
  {#snippet actions()}
    <!-- Outside the keyed list below, so focus stays on it from roll to roll. -->
    <Button onclick={roll} disabled={!games.data || pool.length === 0}>
      <Dices class="size-4" />
      {picks.length ? t("random.rollAgain") : t("random.roll")}
    </Button>
  {/snippet}
</PageHeader>

<!-- Prerendered with the store's defaults (five, any type, no dead games), so
     hydration finds the same pressed buttons. A choice made before the
     catalogue arrives is kept for the first roll. -->
<div class="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
  <div class="min-w-0">
    <p id="random-count" class="mb-1.5 text-xs font-medium text-muted-foreground">{t("random.countLabel")}</p>
    <div role="group" aria-labelledby="random-count" class="flex flex-wrap gap-1">
      {#each PICK_COUNTS as n (n)}
        <button
          type="button"
          onclick={() => changeCount(n)}
          aria-pressed={randomPicks.count === n}
          class={cn(choice(randomPicks.count === n), "w-10 px-0 tnum")}
        >
          {n}
        </button>
      {/each}
    </div>
  </div>

  <div class="min-w-0">
    <p id="random-type" class="mb-1.5 text-xs font-medium text-muted-foreground">{t("detail.labelType")}</p>
    <div role="group" aria-labelledby="random-type" class="flex flex-wrap gap-1">
      {#each TYPES as option (option.value)}
        <button
          type="button"
          onclick={() => changeType(option.value)}
          aria-pressed={randomPicks.type === option.value}
          class={choice(randomPicks.type === option.value)}
        >
          {t(option.label)}
        </button>
      {/each}
    </div>
  </div>

  <label class="flex cursor-pointer items-center gap-2 py-2 text-sm" title={t("games.deadTitle")}>
    <input
      type="checkbox"
      checked={randomPicks.includeDead}
      onchange={(e) => changeDead(e.currentTarget.checked)}
      class="size-4 shrink-0 accent-[hsl(var(--primary))]"
    />
    {t("random.includeDead")}
  </label>
</div>

<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>

<QueryState loading={games.pending} error={games.error} retry={() => games.refetch()}>
  {#if pool.length === 0}
    <div class="rounded-lg border bg-card py-16 text-center">
      <p class="text-sm text-muted-foreground">{t("random.noMatch")}</p>
    </div>
  {:else}
    <p class="mb-3 text-xs text-muted-foreground tnum">
      {t("random.pool", { count: pool.length, total: formatNumber(pool.length) })}
    </p>
    <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each picks as { appid, record: r } (appid)}
        {@const pct = parseReviewPercent(r.reviews)}
        <li class="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-border-strong">
          <a href="/games/{appid}" class="group block">
            <!-- The 460 px hero, not the 230 px thumbnail: a card is 235-480 px
                 wide, and the thumbnail went soft scaled up that far. -->
            {#if r.header_image}
              <img
                src={heroImage(r.header_image)}
                {@attach imgFallback(heroFallback(r.header_image))}
                alt=""
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
                width="460"
                height="215"
                class="aspect-[460/215] w-full bg-muted object-cover"
              />
            {:else}
              <div class="aspect-[460/215] w-full bg-muted"></div>
            {/if}
            <h2 class="flex items-center gap-1.5 px-4 pt-3 text-base font-semibold group-hover:text-primary">
              {#if r.is_dead}<span title={t("games.deadTitle")}>💀</span>{/if}
              <span class="min-w-0 truncate">{r.name || "—"}</span>
            </h2>
          </a>

          <div class="flex flex-wrap items-center gap-1 px-4 pt-2">
            {#if r.type_game}
              <Badge variant={r.type_game === "online" ? "success" : "secondary"}>
                {t(r.type_game === "online" ? "common.online" : "common.offline")}
              </Badge>
            {/if}
            {#if r.genre}<Badge variant="outline">{r.genre}</Badge>{/if}
            {#if r.anti_cheat && r.anti_cheat !== "-"}
              <Badge variant={r.is_kernel_ac ? "destructive" : "warning"} class="block max-w-full truncate">
                {r.anti_cheat}
              </Badge>
            {/if}
          </div>

          <dl class="grid grid-cols-2 gap-2 px-4 py-3 text-sm">
            <div class="min-w-0">
              <dt class="text-xs text-muted-foreground">{t("detail.labelPlayers")}</dt>
              <dd class="font-mono tnum">{formatNumber(r.current_players)}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs text-muted-foreground">{t("detail.labelReviews")}</dt>
              <dd class="truncate">
                {#if pct !== null}
                  <span class="font-mono tnum {reviewTone(pct)}">{pct}%</span>
                  <span class="text-xs text-muted-foreground">{reviewLabel(r.reviews) ?? ""}</span>
                {:else}
                  —
                {/if}
              </dd>
            </div>
          </dl>

          <div class="mt-auto border-t px-4 py-2.5">
            <!-- A plain external link. In the apps the capture-phase interceptor
                 (lib/external-link-interceptor.ts) hands it to the shell plugin,
                 exactly like the game page's Web button. -->
            <a
              href={steamWebUrl(appid)}
              target="_blank"
              rel="noreferrer"
              class="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <ExternalLink class="size-3.5" />
              <!-- The separator is an expression: Svelte trims a leading space
                   inside an element, and the name ran into the label. -->
              {t("random.openOnSteam")}<span class="sr-only">{` - ${r.name}`}</span>
            </a>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</QueryState>
