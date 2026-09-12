<script lang="ts">
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import Monitor from "@lucide/svelte/icons/monitor";
  import Languages from "@lucide/svelte/icons/languages";
  import Info from "@lucide/svelte/icons/info";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { goto } from "$app/navigation";
  import { i18n, SUPPORTED_LANGUAGES, type SupportedLanguage } from "$lib/i18n.svelte";
  import { theme, welcome, type Theme } from "$lib/prefs.svelte";
  import { clearCache } from "$lib/cache";
  import { games } from "$lib/games.svelte";
  import { cn } from "$lib/utils";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import Button from "$lib/ui/Button.svelte";

  const t = i18n.t;

  const LANG_NAMES: Record<SupportedLanguage, { flag: string; native: string; english: string }> = {
    en: { flag: "🇬🇧", native: "English", english: "English" },
    vi: { flag: "🇻🇳", native: "Tiếng Việt", english: "Vietnamese" },
  };

  const THEMES: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "settings.themeLight" },
    { value: "dark", icon: Moon, label: "settings.themeDark" },
    { value: "system", icon: Monitor, label: "settings.themeSystem" },
  ];

  let clearing = $state(false);

  async function clearLocalData() {
    clearing = true;
    try {
      await clearCache();
      // Refetch rather than leaving the page showing records that are no
      // longer cached: "cleared" should not also mean "now empty".
      await games.refetch();
    } finally {
      clearing = false;
    }
  }
</script>

<svelte:head>
  <title>{t("settings.title")} · Steam F2P Tracker</title>
  <meta name="description" content={t("settings.subtitle")} />
</svelte:head>

<PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

<div class="max-w-2xl space-y-4">
  <section class="rounded-lg border bg-card p-5">
    <h2 class="flex items-center gap-2 text-base font-semibold">
      <Languages class="size-4 text-muted-foreground" />
      {t("settings.languageTitle")}
    </h2>
    <p class="mt-1 text-sm text-muted-foreground">{t("settings.languageHint")}</p>
    <div class="mt-3 grid gap-2 sm:grid-cols-2">
      {#each SUPPORTED_LANGUAGES as lang (lang)}
        {@const meta = LANG_NAMES[lang]}
        <button
          type="button"
          onclick={() => void i18n.setLanguage(lang)}
          aria-pressed={i18n.lang === lang}
          class={cn(
            "flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
            i18n.lang === lang
              ? "border-primary/50 bg-primary/10"
              : "hover:border-border-strong hover:bg-accent",
          )}
        >
          <span class="text-xl" aria-hidden="true">{meta.flag}</span>
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium">{meta.native}</span>
            <span class="block truncate text-xs text-muted-foreground">{meta.english}</span>
          </span>
        </button>
      {/each}
    </div>
  </section>

  <section class="rounded-lg border bg-card p-5">
    <h2 class="flex items-center gap-2 text-base font-semibold">
      <Monitor class="size-4 text-muted-foreground" />
      {t("settings.theme")}
    </h2>
    <p class="mt-1 text-sm text-muted-foreground">{t("settings.themeHint")}</p>
    <div class="mt-3 grid gap-2 sm:grid-cols-3">
      {#each THEMES as option (option.value)}
        <button
          type="button"
          onclick={() => theme.set(option.value)}
          aria-pressed={theme.value === option.value}
          class={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm transition-colors",
            theme.value === option.value
              ? "border-primary/50 bg-primary/10"
              : "hover:border-border-strong hover:bg-accent",
          )}
        >
          <option.icon class="size-4" />
          {t(option.label)}
          {#if option.value === "system"}
            <span class="ml-auto text-xs text-muted-foreground">{theme.resolved}</span>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  <section class="rounded-lg border bg-card p-5">
    <h2 class="flex items-center gap-2 text-base font-semibold">
      <Info class="size-4 text-muted-foreground" />
      {t("settings.welcomeTitle")}
    </h2>
    <p class="mt-1 text-sm text-muted-foreground">{t("settings.welcomeHint")}</p>
    <Button
      class="mt-3"
      variant="outline"
      onclick={() => {
        welcome.reset();
        void goto("/welcome");
      }}
    >
      {t("settings.welcomeAction")}
    </Button>
  </section>

  <section class="rounded-lg border bg-card p-5">
    <h2 class="flex items-center gap-2 text-base font-semibold">
      <Trash2 class="size-4 text-muted-foreground" />
      {t("settings.cacheTitle")}
    </h2>
    <p class="mt-1 text-sm text-muted-foreground">{t("settings.cacheHint")}</p>
    <Button class="mt-3" variant="outline" disabled={clearing} onclick={clearLocalData}>
      {clearing ? t("common.loading") : t("settings.cacheAction")}
    </Button>
  </section>
</div>
