<script lang="ts">
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import GitCommit from "@lucide/svelte/icons/git-commit-horizontal";
  import Bot from "@lucide/svelte/icons/bot";
  import User from "@lucide/svelte/icons/user";
  import Filter from "@lucide/svelte/icons/funnel";
  import { Resource } from "$lib/resource.svelte";
  import { i18n } from "$lib/i18n.svelte";
  import { API_ORIGIN } from "$lib/site";
  import { DEFAULT_BRANCH } from "$lib/schema";
  import { formatRelativeDate, cn } from "$lib/utils";
  import QueryState from "$lib/common/QueryState.svelte";
  import PageHeader from "$lib/common/PageHeader.svelte";
  import Badge from "$lib/ui/Badge.svelte";
  import Button from "$lib/ui/Button.svelte";

  const t = i18n.t;

  /**
   * Flattened by the Worker, not by GitHub. /api/activity narrows the upstream
   * payload to these fields, so the commit-author email GitHub returns for
   * every commit never reaches the browser, `subject` is the first line only
   * (the bodies carry Co-Authored-By trailers with real addresses), and
   * `avatar` arrives already rewritten to this site's own /img/gh/ proxy.
   */
  interface Commit {
    sha: string;
    html_url: string;
    subject: string;
    author_date: string;
    author_name: string;
    login: string | null;
    avatar: string | null;
    verified: boolean;
    reason: string;
  }

  const BOT_LOGIN = "github-actions[bot]";

  // refetchOnFocus: the feed is the one page where coming back to the tab and
  // seeing yesterday's state would be actively misleading.
  const activity = new Resource<Commit[]>(
    async (signal) => {
      const res = await fetch(`${API_ORIGIN}/api/activity`, { signal });
      if (!res.ok) throw new Error(`Activity: ${res.status} ${res.statusText}`);
      return ((await res.json()) as { commits?: Commit[] }).commits ?? [];
    },
    { staleTime: 60_000, refetchOnFocus: true },
  );

  $effect(() => {
    void activity.load();
  });

  let filter = $state<"all" | "bot">("all");

  const commits = $derived(activity.data ?? []);
  const shown = $derived(filter === "bot" ? commits.filter((c) => c.login === BOT_LOGIN) : commits);
</script>

<svelte:head>
  <title>{t("activity.title")} · Steam F2P Tracker</title>
  <meta name="description" content={t("activity.subtitle", { count: commits.length, branch: DEFAULT_BRANCH })} />
</svelte:head>

<PageHeader
  title={t("activity.title")}
  subtitle={t("activity.subtitle", { count: commits.length, branch: DEFAULT_BRANCH })}
>
  {#snippet actions()}
    <div class="flex items-center gap-1 rounded-md border p-0.5 text-xs">
      <Filter class="ml-1 size-3 text-muted-foreground" />
      {#each ["all", "bot"] as const as f (f)}
        <Button
          size="sm"
          variant={filter === f ? "default" : "ghost"}
          class="h-6 text-xs"
          onclick={() => (filter = f)}
        >
          {f === "bot" ? t("activity.filterBots") : t("activity.filterAll")}
        </Button>
      {/each}
    </div>
  {/snippet}
</PageHeader>

<QueryState
  loading={activity.loading && !activity.data}
  error={activity.error}
  retry={() => activity.refetch()}
>
  <p class="mb-3 text-xs text-muted-foreground tnum">
    {t("activity.showingCount", { count: shown.length })}
  </p>

  <ul class="divide-y rounded-lg border bg-card">
    {#each shown as c (c.sha)}
      {@const isBot = c.login === BOT_LOGIN}
      <li class="flex items-start gap-3 px-4 py-3 hover:bg-accent/40">
        <div class="mt-0.5 shrink-0">
          {#if c.avatar}
            <img
              src={`${API_ORIGIN}${c.avatar}`}
              alt=""
              loading="lazy"
              decoding="async"
              class={cn("size-7 rounded-full border", isBot && "ring-1 ring-warning/40")}
            />
          {:else}
            <div class="grid size-7 place-items-center rounded-full border bg-muted">
              <GitCommit class="size-3 text-muted-foreground" />
            </div>
          {/if}
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <a
              href={c.html_url}
              target="_blank"
              rel="noreferrer"
              class="truncate text-sm font-medium hover:text-primary"
            >
              {c.subject || t("activity.noMessage")}
            </a>
            <ExternalLink class="size-3 shrink-0 text-muted-foreground opacity-50" />
          </div>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span class="inline-flex items-center gap-1">
              {#if isBot}<Bot class="size-3" />{:else}<User class="size-3" />{/if}
              {c.login || c.author_name}
            </span>
            <span aria-hidden="true">·</span>
            <span title={c.author_date}>{formatRelativeDate(c.author_date)}</span>
            <span aria-hidden="true">·</span>
            <code class="rounded bg-muted px-1 tnum">{c.sha.slice(0, 7)}</code>
          </div>
        </div>

        <div class="shrink-0">
          {#if c.verified}
            <Badge variant="success">
              <ShieldCheck class="mr-1 size-3" />
              {t("activity.verifiedBadge")}
            </Badge>
          {:else if c.reason === "unsigned"}
            <Badge variant="secondary">{t("activity.unsignedBadge")}</Badge>
          {:else}
            <Badge variant="warning" title={t("activity.reasonPrefix", { reason: c.reason })}>
              <ShieldAlert class="mr-1 size-3" />
              {c.reason}
            </Badge>
          {/if}
        </div>
      </li>
    {/each}

    {#if !shown.length}
      <li class="px-4 py-10 text-center text-sm text-muted-foreground">
        {t("activity.noMatches")}
      </li>
    {/if}
  </ul>
</QueryState>
