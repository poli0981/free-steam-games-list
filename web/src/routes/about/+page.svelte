<script lang="ts">
  import Mail from "@lucide/svelte/icons/mail";
  import LinkIcon from "@lucide/svelte/icons/link";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Scale from "@lucide/svelte/icons/scale";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import FileText from "@lucide/svelte/icons/file-text";
  import Bug from "@lucide/svelte/icons/bug";
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { LEGAL_DOCS, legalDocSlug } from "$lib/legal";
  import { REPO_OWNER, REPO_NAME } from "$lib/schema";
  import { formatNumber } from "$lib/utils";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import Badge from "$lib/ui/Badge.svelte";

  const t = i18n.t;
  const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

  const total = $derived(games.data?.records.length ?? 0);
  const lastUpdated = $derived(games.data?.index.last_updated ?? "");

  // Two entries, not nine. Every other channel now lives at
  // poli0981.dev/links/, so a retired account cannot leave a dead link in a
  // shipped build - which had already happened three times.
  const CONTACTS = [
    { icon: Mail, label: "Email", handle: "contact@poli0981.dev", href: "mailto:contact@poli0981.dev" },
    { icon: LinkIcon, label: t("about.everyOtherChannel"), handle: "poli0981.dev/links", href: "https://poli0981.dev/links/" },
  ];

  /**
   * The real stack. The React page advertised React 18, TypeScript 5, Tailwind
   * CSS 3, tailwindcss-animate, PostCSS + autoprefixer and OpenPGP.js - every
   * one of them wrong by the end, and OpenPGP.js was not even a dependency, so
   * the page credited a library that did not ship.
   */
  const DEPS = [
    { name: "Svelte 5", role: "UI runtime", href: "https://svelte.dev/", licence: "MIT" },
    { name: "SvelteKit 2", role: "routing + prerendering", href: "https://svelte.dev/docs/kit", licence: "MIT" },
    { name: "TypeScript 6", role: "type system", href: "https://www.typescriptlang.org/", licence: "Apache-2.0" },
    { name: "Vite 8 / Rolldown", role: "build", href: "https://vitejs.dev/", licence: "MIT" },
    { name: "Tailwind CSS 4", role: "styling", href: "https://tailwindcss.com/", licence: "MIT" },
    { name: "Bits UI", role: "headless UI primitives", href: "https://bits-ui.com/", licence: "MIT" },
    { name: "Apache ECharts 6", role: "charts", href: "https://echarts.apache.org/", licence: "Apache-2.0" },
    { name: "TanStack Virtual", role: "virtualised 3,600-row table", href: "https://tanstack.com/virtual", licence: "MIT" },
    { name: "Fuse.js", role: "fuzzy search", href: "https://www.fusejs.io/", licence: "Apache-2.0" },
    { name: "idb-keyval", role: "IndexedDB cache", href: "https://github.com/jakearchibald/idb-keyval", licence: "Apache-2.0" },
    { name: "unified / remark / rehype", role: "legal docs, at build time only", href: "https://unifiedjs.com/", licence: "MIT" },
    { name: "Bricolage Grotesque", role: "display typeface", href: "https://github.com/ateliertriay/bricolage", licence: "OFL-1.1" },
    { name: "IBM Plex Sans", role: "body typeface", href: "https://github.com/IBM/plex", licence: "OFL-1.1" },
    { name: "JetBrains Mono", role: "monospace typeface", href: "https://github.com/JetBrains/JetBrainsMono", licence: "OFL-1.1" },
    { name: "Tauri 2", role: "desktop + Android shell", href: "https://v2.tauri.app/", licence: "MIT or Apache-2.0" },
  ];

  const ISSUE_TEMPLATES = [
    { id: "bug_report", label: t("about.tplBug"), icon: Bug },
    { id: "feature_request", label: t("about.tplFeature"), icon: Sparkles },
    { id: "delete_game", label: t("about.tplDelete"), icon: TriangleAlert },
  ];
</script>

<svelte:head>
  <title>{t("about.title")} · Steam F2P Tracker</title>
  <meta name="description" content={t("about.subtitle")} />
</svelte:head>

<PageHeader title={t("about.title")} subtitle={t("about.subtitle")} />

<div class="max-w-3xl space-y-4">
  <section class="rounded-lg border bg-card p-5">
    <h2 class="text-base font-semibold">{t("about.repositoryTitle")}</h2>
    <div class="mt-3 grid gap-3 sm:grid-cols-2">
      <div class="rounded-md border bg-muted/30 p-3">
        <Badge variant="secondary">{t("about.trackedGamesLabel")}</Badge>
        <div class="mt-1 truncate font-display text-xl font-semibold tnum">{formatNumber(total)}</div>
      </div>
      <div class="rounded-md border bg-muted/30 p-3">
        <Badge variant="secondary">{t("about.dataLastUpdatedLabel")}</Badge>
        <div class="mt-1 truncate font-display text-xl font-semibold tnum">
          {lastUpdated ? lastUpdated.slice(0, 16).replace("T", " ") + "Z" : "—"}
        </div>
      </div>
    </div>
    <p class="mt-3 text-sm text-muted-foreground">{t("about.repositoryBlurb")}</p>
    <div class="mt-3 flex flex-wrap gap-2">
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
      >
        <ExternalLink class="size-3.5" /> GitHub
      </a>
      <a
        href={`${REPO_URL}/tree/main/data`}
        target="_blank"
        rel="noreferrer"
        class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
      >
        <FileText class="size-3.5" /> {t("about.rawData")}
      </a>
    </div>
  </section>

  <section class="rounded-lg border bg-card p-5">
    <h2 class="flex items-center gap-2 text-base font-semibold">
      <TriangleAlert class="size-4 text-warning" />
      {t("about.headsUpTitle")}
    </h2>
    <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
      <li>{t("about.headsUpGenre")}</li>
      <li>{t("about.headsUpEnglish")}</li>
      <li>{t("about.headsUpValve")}</li>
    </ul>
  </section>

  <section class="rounded-lg border bg-card p-5">
    <h2 class="flex items-center gap-2 text-base font-semibold">
      <Sparkles class="size-4 text-primary" />
      {t("about.aiDisclosureTitle")}
    </h2>
    <p class="mt-2 text-sm text-muted-foreground">{t("about.aiDisclosureBody")}</p>
  </section>

  <section class="rounded-lg border bg-card p-5">
    <h2 class="text-base font-semibold">{t("about.maintainerTitle")}</h2>
    <p class="mt-1 text-sm text-muted-foreground">{t("about.maintainerBlurb")}</p>
    <div class="mt-3 grid gap-2 sm:grid-cols-2">
      {#each CONTACTS as c (c.label)}
        <a
          href={c.href}
          target={c.href.startsWith("mailto:") ? undefined : "_blank"}
          rel="noreferrer"
          class="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
        >
          <c.icon class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block font-medium">{c.label}</span>
            <span class="block truncate text-xs text-muted-foreground">{c.handle}</span>
          </span>
          <ExternalLink class="size-3 shrink-0 text-muted-foreground" />
        </a>
      {/each}
    </div>
  </section>

  <section class="rounded-lg border bg-card p-5">
    <h2 class="flex items-center gap-2 text-base font-semibold">
      <Bug class="size-4 text-muted-foreground" />
      {t("about.reportTitle")}
    </h2>
    <div class="mt-3 grid gap-2 sm:grid-cols-3">
      {#each ISSUE_TEMPLATES as tpl (tpl.id)}
        <a
          href={`${REPO_URL}/issues/new?template=${tpl.id}.yml`}
          target="_blank"
          rel="noreferrer"
          class="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
        >
          <tpl.icon class="size-4 shrink-0 text-muted-foreground" />
          <span class="flex-1 truncate">{tpl.label}</span>
        </a>
      {/each}
    </div>
  </section>

  <section class="rounded-lg border bg-card p-5">
    <h2 class="flex items-center gap-2 text-base font-semibold">
      <Scale class="size-4 text-muted-foreground" />
      {t("about.legalTitle")}
    </h2>
    <p class="mt-2 text-sm text-muted-foreground">{t("about.legalBlurb")}</p>
    <ul class="mt-3 space-y-1.5">
      {#each LEGAL_DOCS as doc (doc.path)}
        <li>
          <!-- Real in-app routes, rendered at build time. -->
          <a
            href="/legal/{legalDocSlug(doc.path)}"
            class="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
          >
            <span class="font-medium">{doc.label}</span>
            <span class="ml-2 hidden truncate text-xs text-muted-foreground sm:block">{doc.hint}</span>
          </a>
        </li>
      {/each}
    </ul>
  </section>

  <section class="rounded-lg border bg-card p-5">
    <h2 class="flex items-center gap-2 text-base font-semibold">
      <FileText class="size-4 text-muted-foreground" />
      {t("about.stackTitle")}
    </h2>
    <ul class="mt-3 space-y-1.5">
      {#each DEPS as d (d.name)}
        <li class="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm">
          <a href={d.href} target="_blank" rel="noreferrer" class="min-w-0 truncate font-medium hover:text-primary">
            {d.name}
          </a>
          <span class="hidden truncate text-xs text-muted-foreground sm:inline">{d.role}</span>
          <Badge variant="outline" class="shrink-0 font-mono">{d.licence}</Badge>
        </li>
      {/each}
    </ul>
    <p class="mt-4 border-t pt-3 text-xs text-muted-foreground">{t("about.trademarkNote")}</p>
  </section>
</div>
