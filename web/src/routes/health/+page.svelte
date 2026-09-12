<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Calendar from "@lucide/svelte/icons/calendar";
  import ShieldQuestion from "@lucide/svelte/icons/shield-question-mark";
  import HeartPulse from "@lucide/svelte/icons/heart-pulse";
  import type { Component } from "svelte";
  import { games } from "$lib/games.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { isEmpty, appidOf } from "$lib/data-store";
  import { formatNumber, formatRelativeDate } from "$lib/utils";
  import type { GameRecord } from "$lib/schema";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import Badge from "$lib/ui/Badge.svelte";
  import Seo from "$lib/common/Seo.svelte";

  const t = i18n.t;

  type GroupKey = "Delisted" | "Stale" | "Missing" | "Kernel" | "OnlineAcUnknown";

  interface Group {
    key: GroupKey;
    records: GameRecord[];
    icon: Component<{ class?: string }>;
    variant: "warning" | "destructive" | "secondary";
  }

  const STALE_DAYS = 30;

  const groups = $derived.by((): Group[] => {
    const delisted: GameRecord[] = [];
    const stale: GameRecord[] = [];
    const missing: GameRecord[] = [];
    const kernel: GameRecord[] = [];
    const acUnknown: GameRecord[] = [];
    const now = Date.now();

    for (const r of games.data?.records ?? []) {
      if (r.status === "delisted") delisted.push(r);

      if (r.last_updated) {
        const ts = new Date(r.last_updated).getTime();
        if (!Number.isNaN(ts) && (now - ts) / 86_400_000 > STALE_DAYS) stale.push(r);
      }

      // The three MANUAL_FIELDS a human is expected to fill in. isEmpty rather
      // than a falsy check: "-" and "?" are meaningful skeleton defaults.
      if (isEmpty(r.genre) || isEmpty(r.type_game) || isEmpty(r.safe)) missing.push(r);

      const ac = (r.anti_cheat ?? "").trim();
      const acBlank = ac === "" || ac === "-";

      // == null, not === null: the field is tri-state and undefined counts as
      // unchecked too.
      if (r.type_game === "online" && r.is_kernel_ac == null && !acBlank) kernel.push(r);
      if (r.type_game === "online" && acBlank) acUnknown.push(r);
    }

    return [
      { key: "Delisted", records: delisted, icon: Trash2, variant: "destructive" },
      { key: "Stale", records: stale, icon: Calendar, variant: "warning" },
      { key: "Missing", records: missing, icon: TriangleAlert, variant: "warning" },
      { key: "Kernel", records: kernel, icon: ShieldQuestion, variant: "secondary" },
      { key: "OnlineAcUnknown", records: acUnknown, icon: ShieldQuestion, variant: "secondary" },
    ].filter((g) => g.records.length > 0) as Group[];
  });

  const flaggedTotal = $derived(groups.reduce((sum, g) => sum + g.records.length, 0));
  const subtitle = $derived(
    t("health.subtitle", { total: formatNumber(flaggedTotal), categories: groups.length }),
  );
</script>

<Seo title={t("health.title")} description={subtitle} />

<PageHeader title={t("health.title")} subtitle={subtitle} />

<QueryState loading={games.loading && !games.data} error={games.error} retry={() => games.refetch()}>
  {#if !groups.length}
    <div class="rounded-lg border bg-card py-16 text-center">
      <HeartPulse class="mx-auto mb-3 size-8 text-success" />
      <p class="text-sm text-muted-foreground">{t("health.allClear")}</p>
    </div>
  {:else}
    <div class="space-y-4">
      {#each groups as group (group.key)}
        <section class="rounded-lg border bg-card">
          <header class="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <group.icon class="size-4 shrink-0 text-muted-foreground" />
            <h2 class="font-display text-base font-semibold">
              {t(`health.group${group.key}`)}
            </h2>
            <Badge variant={group.variant}>{formatNumber(group.records.length)}</Badge>
            <p class="w-full text-sm text-muted-foreground sm:w-auto sm:flex-1">
              {t(`health.group${group.key}Desc`)}
            </p>
          </header>

          <ul class="divide-y">
            {#each group.records.slice(0, 10) as r (r.link)}
              {@const appid = appidOf(r)}
              <li>
                <a
                  href={appid ? `/games/${appid}` : r.link}
                  class="flex items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <span class="min-w-0 flex-1 truncate">{r.name}</span>
                  {#if group.key === "Stale"}
                    <span class="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeDate(r.last_updated)}
                    </span>
                  {/if}
                </a>
              </li>
            {/each}
          </ul>

          {#if group.records.length > 10}
            <p class="border-t px-4 py-2 text-xs text-muted-foreground">
              {t("games.showing", { shown: 10, total: formatNumber(group.records.length) })}
            </p>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</QueryState>
