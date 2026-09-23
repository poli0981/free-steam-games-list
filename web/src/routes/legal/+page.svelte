<script lang="ts">
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import FileText from "@lucide/svelte/icons/file-text";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { i18n } from "$lib/i18n.svelte";
  import { LEGAL_DOCS, legalDocSlug } from "$lib/legal";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import Seo from "$lib/common/Seo.svelte";

  const t = i18n.t;

  // Every document page links back here. It is readable before consent and
  // before the human check, like the documents themselves (lib/gates.ts).
  const GROUPS = [
    { key: "binding", icon: ShieldCheck, title: "legal.binding", docs: LEGAL_DOCS.filter((d) => d.consent) },
    { key: "other", icon: FileText, title: "legal.otherDocs", docs: LEGAL_DOCS.filter((d) => !d.consent) },
  ];
</script>

<Seo title={t("legal.title")} description={t("legal.subtitle")} />

<div class="mx-auto max-w-3xl">
  <PageHeader title={t("legal.title")} subtitle={t("legal.subtitle")} />

  <div class="space-y-6">
    {#each GROUPS as group (group.key)}
      <section>
        <h2 class="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          <group.icon class="size-3.5" />
          {t(group.title)}
        </h2>
        <ul class="grid gap-2 sm:grid-cols-2">
          {#each group.docs as doc (doc.path)}
            <li>
              <a
                href="/legal/{legalDocSlug(doc.path)}"
                class="group flex h-full flex-col rounded-lg border bg-card p-4 transition-colors hover:border-border-strong hover:bg-accent"
              >
                <span class="flex items-center justify-between gap-2 font-medium">
                  {t(doc.label)}
                  <ChevronRight class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <span class="mt-1 text-sm text-muted-foreground">{t(doc.hint)}</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</div>
