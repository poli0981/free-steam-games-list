<script lang="ts">
  import type { Component } from "svelte";
  import Heart from "@lucide/svelte/icons/heart";
  import Coffee from "@lucide/svelte/icons/coffee";
  import Gift from "@lucide/svelte/icons/gift";
  import Github from "@lucide/svelte/icons/git-branch";
  import CreditCard from "@lucide/svelte/icons/credit-card";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { i18n } from "$lib/i18n.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import Seo from "$lib/common/Seo.svelte";

  const t = i18n.t;

  // Donation links, NOT contact channels - the contact list collapsed to
  // poli0981.dev/links/, these did not. They are separate surfaces with
  // separate URLs and belong here.
  const PLATFORMS: { key: string; href: string; icon: Component<{ class?: string }> }[] = [
    { key: "github", href: "https://github.com/sponsors/poli0981", icon: Github },
    { key: "kofi", href: "https://ko-fi.com/skullmute", icon: Coffee },
    { key: "bmc", href: "https://buymeacoffee.com/skullmute", icon: Coffee },
    { key: "patreon", href: "https://patreon.com/skullmute", icon: Gift },
    { key: "paypal", href: "https://paypal.me/DungDang212", icon: CreditCard },
  ];
</script>

<Seo title={t("donate.title")} description={t("donate.subtitle")} />

<PageHeader title={t("donate.title")} />

<div class="max-w-2xl space-y-4">
  <div class="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-5">
    <Heart class="mt-0.5 size-5 shrink-0 text-primary" />
    <p class="text-sm text-muted-foreground">{t("donate.subtitle")}</p>
  </div>

  <div class="grid gap-2 sm:grid-cols-2">
    {#each PLATFORMS as p (p.key)}
      <a
        href={p.href}
        target="_blank"
        rel="noreferrer"
        class="group flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors
               hover:border-border-strong hover:bg-accent"
      >
        <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <p.icon class="size-4" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block font-medium">{t(`donate.platform.${p.key}`)}</span>
          <span class="mt-0.5 block text-sm text-muted-foreground">
            {t(`donate.platform.${p.key}Desc`)}
          </span>
        </span>
        <ExternalLink class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      </a>
    {/each}
  </div>

  <p class="text-sm text-muted-foreground">{t("donate.footnote")}</p>
</div>
