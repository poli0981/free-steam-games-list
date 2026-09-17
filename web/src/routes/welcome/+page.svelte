<!--
  First-run introduction, shown AFTER the legal gate, never instead of it.

  Kept deliberately short: what the data is, how honest it is, how fresh it is,
  three ways in, the language, and the documents just accepted. It never waits
  for the dataset: the count fills in when the catalogue has loaded, and its
  absence never delays the first paint.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Gamepad2 from "@lucide/svelte/icons/gamepad-2";
  import ChartColumn from "@lucide/svelte/icons/chart-column";
  import Trophy from "@lucide/svelte/icons/trophy";
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Languages from "@lucide/svelte/icons/languages";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import { games } from "$lib/games.svelte";
  import { welcome } from "$lib/prefs.svelte";
  import { i18n, LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from "$lib/i18n.svelte";
  import { CONSENT_DOCS, legalDocSlug } from "$lib/legal";
  import { cn, formatNumber } from "$lib/utils";
  import Seo from "$lib/common/Seo.svelte";

  const t = i18n.t;

  const total = $derived(games.data?.records.length ?? 0);
  const lastUpdated = $derived(games.data?.index.last_updated?.slice(0, 10) ?? "");

  // Seen once SHOWN, not once a button is pressed. The layout sends a first
  // visitor here from the dashboard; marked any later, Back would send them
  // straight here again.
  onMount(() => welcome.markSeen());

  const entries = $derived([
    { to: "/games", icon: Gamepad2, title: t("welcome.entry.browse.title"), body: t("welcome.entry.browse.body") },
    { to: "/charts", icon: ChartColumn, title: t("welcome.entry.charts.title"), body: t("welcome.entry.charts.body") },
    { to: "/top-online", icon: Trophy, title: t("welcome.entry.leaderboards.title"), body: t("welcome.entry.leaderboards.body") },
  ]);
</script>

<Seo title={t("welcome.title")} description={t("welcome.heading")} />

<div class="min-h-dvh bg-background">
  <div class="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-12 sm:py-16">
    <header class="space-y-4">
      <span class="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Gamepad2 class="size-6" />
      </span>
      <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{t("welcome.heading")}</h1>
      <p class="max-w-2xl text-base leading-relaxed text-muted-foreground">
        {total ? t("welcome.introWithCount", { total: formatNumber(total) }) : t("welcome.intro")}
      </p>
    </header>

    <!-- The honest framing docs/DISCLAIMER.md already takes. Putting it up front
         is the point of the page: someone should know what this list is and is
         not before relying on it. -->
    <section class="rounded-lg border border-warning/30 bg-warning/5 p-5">
      <h2 class="flex items-center gap-2 text-sm font-semibold">
        <ShieldAlert class="size-4 text-warning" />
        {t("welcome.honestTitle")}
      </h2>
      <ul class="mt-3 space-y-2 text-sm text-muted-foreground">
        <li class="flex gap-2"><span aria-hidden="true">•</span><span>{t("welcome.honest1")}</span></li>
        <li class="flex gap-2"><span aria-hidden="true">•</span><span>{t("welcome.honest2")}</span></li>
        <li class="flex gap-2"><span aria-hidden="true">•</span><span>{t("welcome.honest3")}</span></li>
      </ul>
      <p class="mt-4 flex items-start gap-2 border-t border-warning/20 pt-3 text-xs text-muted-foreground">
        <RefreshCw class="mt-0.5 size-3.5 shrink-0 text-primary" />
        <span>
          {t("welcome.freshness")}
          {#if lastUpdated}<span class="tnum">{t("welcome.lastUpdated", { date: lastUpdated })}</span>{/if}
        </span>
      </p>
    </section>

    <section class="space-y-3">
      <h2 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("welcome.startHere")}</h2>
      <ul class="grid gap-3 sm:grid-cols-3">
        {#each entries as entry (entry.to)}
          <li>
            <a
              href={entry.to}
              class="group flex h-full flex-col rounded-lg border bg-card p-4 transition-colors hover:border-border-strong hover:bg-accent"
            >
              <entry.icon class="mb-3 size-5 text-primary" />
              <span class="text-sm font-medium">{entry.title}</span>
              <span class="mt-1 text-xs text-muted-foreground">{entry.body}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>

    <div class="grid gap-8 sm:grid-cols-2">
      <section class="space-y-3">
        <h2 class="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          <Languages class="size-3.5" />
          {t("welcome.language")}
        </h2>
        <div class="flex flex-wrap gap-2">
          <!-- No flag: Windows has no flag emoji and draws "GB" and "VN" instead,
               and a language is not a country anyway. -->
          {#each SUPPORTED_LANGUAGES as lang (lang)}
            {@const meta = LANGUAGE_NAMES[lang]}
            <button
              type="button"
              onclick={() => void i18n.setLanguage(lang)}
              aria-pressed={i18n.lang === lang}
              class={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                i18n.lang === lang ? "border-primary/50 bg-primary/10" : "hover:border-border-strong hover:bg-accent",
              )}
            >
              {meta.native}
            </button>
          {/each}
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          <ScrollText class="size-3.5" />
          {t("welcome.paperwork")}
        </h2>
        <p class="text-sm text-muted-foreground">{t("welcome.paperworkBody")}</p>
        <ul class="flex flex-wrap gap-1.5">
          {#each CONSENT_DOCS as doc (doc.path)}
            <li>
              <a
                href="/legal/{legalDocSlug(doc.path)}"
                class="block rounded-md border bg-card px-2.5 py-1 text-xs transition-colors hover:bg-accent"
              >
                {t(doc.label)}
              </a>
            </li>
          {/each}
        </ul>
      </section>
    </div>

    <footer class="flex flex-wrap items-center gap-3 border-t pt-6">
      <a
        href="/"
        class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {t("welcome.continue")}
        <ArrowRight class="size-4" />
      </a>
      <span class="text-xs text-muted-foreground">{t("welcome.reshowHint")}</span>
    </footer>
  </div>
</div>
