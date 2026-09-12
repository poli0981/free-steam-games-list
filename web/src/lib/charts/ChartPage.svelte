<script lang="ts">
  import type { Snippet } from "svelte";
  import { games } from "../games.svelte";
  import { i18n } from "../i18n.svelte";
  import QueryState from "../common/QueryState.svelte";
  import PageHeader from "../common/PageHeader.svelte";

  /**
   * The shell every chart page shares: head tags, header, load/error handling.
   *
   * In the React app each of the eleven chart pages repeated this, which is why
   * they had drifted — some showed a loading spinner, some rendered an empty
   * chart while the data arrived, and the descriptions were written twice.
   */
  let {
    title,
    subtitle,
    children,
  }: { title: string; subtitle?: string; children: Snippet } = $props();

  const t = i18n.t;
</script>

<svelte:head>
  <title>{title} · Steam F2P Tracker</title>
  {#if subtitle}<meta name="description" content={subtitle} />{/if}
</svelte:head>

<PageHeader {title} {subtitle} />

<QueryState
  loading={games.loading && !games.data}
  error={games.error}
  retry={() => games.refetch()}
>
  {#if !games.data?.records.length}
    <p class="py-16 text-center text-sm text-muted-foreground">{t("common.none")}</p>
  {:else}
    {@render children()}
  {/if}
</QueryState>
