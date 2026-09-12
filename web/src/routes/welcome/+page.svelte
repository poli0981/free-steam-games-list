<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Gamepad2 from "@lucide/svelte/icons/gamepad-2";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import { goto } from "$app/navigation";
  import { games } from "$lib/games.svelte";
  import { welcome } from "$lib/prefs.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { LEGAL_DOCS, legalDocSlug } from "$lib/legal";
  import { formatNumber } from "$lib/utils";
  import Button from "$lib/ui/Button.svelte";

  const t = i18n.t;
  const total = $derived(games.data?.records.length ?? 0);
  const lastUpdated = $derived(games.data?.index.last_updated ?? "");

  function enter(to = "/") {
    welcome.markSeen();
    void goto(to);
  }
</script>

<svelte:head>
  <title>{t("welcome.title")} · Steam F2P Tracker</title>
  <meta name="description" content={t("welcome.heading")} />
</svelte:head>

<div class="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-12">
  <span class="mb-5 grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
    <Gamepad2 class="size-6" />
  </span>

  <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{t("welcome.heading")}</h1>
  <p class="mt-3 max-w-2xl text-muted-foreground">
    {total ? t("welcome.introWithCount", { total: formatNumber(total) }) : t("welcome.intro")}
  </p>

  <section class="mt-8 rounded-lg border bg-card p-5">
    <h2 class="mb-2 text-base font-semibold">{t("welcome.honestTitle")}</h2>
    <ul class="space-y-2 text-sm text-muted-foreground">
      <li class="flex gap-2"><span aria-hidden="true">·</span>{t("welcome.honest1")}</li>
      <li class="flex gap-2"><span aria-hidden="true">·</span>{t("welcome.honest2")}</li>
      <li class="flex gap-2"><span aria-hidden="true">·</span>{t("welcome.honest3")}</li>
    </ul>
    <p class="mt-3 text-xs text-muted-foreground">
      {t("welcome.freshness")}
      {#if lastUpdated}
        <span class="tnum">{t("welcome.lastUpdated", { date: lastUpdated.slice(0, 10) })}</span>
      {/if}
    </p>
  </section>

  <section class="mt-4">
    <h2 class="mb-2 flex items-center gap-2 text-sm font-semibold">
      <ScrollText class="size-4 text-muted-foreground" />
      {t("consent.docsLabel")}
    </h2>
    <div class="flex flex-wrap gap-1.5">
      {#each LEGAL_DOCS as doc (doc.path)}
        <!-- A real link. This used to call e.preventDefault() and redirect to
             /about, because /legal/* did not exist. -->
        <a
          href="/legal/{legalDocSlug(doc.path)}"
          class="rounded-md border bg-card px-2.5 py-1 text-xs transition-colors hover:bg-accent"
        >
          {doc.label}
        </a>
      {/each}
    </div>
  </section>

  <div class="mt-8 flex flex-wrap gap-2">
    <Button onclick={() => enter("/")}>
      {t("welcome.startHere")}
      <ArrowRight class="size-4" />
    </Button>
    <Button variant="outline" onclick={() => enter("/games")}>{t("nav.games")}</Button>
  </div>
</div>
