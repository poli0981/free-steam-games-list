<script lang="ts">
  import type { Snippet } from "svelte";
  import Loader from "@lucide/svelte/icons/loader-circle";
  import WifiOff from "@lucide/svelte/icons/wifi-off";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { i18n } from "../i18n.svelte";
  import Button from "../ui/Button.svelte";

  // Mirrors the React LoadingState/ErrorState pair. Kept as one component
  // because every caller used them together and the loading/error/ready
  // decision belongs in one place.
  let {
    loading,
    error,
    retry,
    children,
  }: {
    loading: boolean;
    error?: Error;
    retry?: () => void;
    children: Snippet;
  } = $props();

  const t = i18n.t;

  // An offline browser gets a different message and no retry button, because
  // retrying while offline just fails again.
  const offline = $derived(typeof navigator !== "undefined" && !navigator.onLine);
</script>

{#if error}
  <div
    class="mx-auto max-w-lg rounded-lg border p-6 text-center {offline
      ? 'border-warning/40 bg-warning/5'
      : 'border-destructive/40 bg-destructive/5'}"
  >
    {#if offline}
      <WifiOff class="mx-auto mb-3 size-8 text-warning" />
      <h2 class="mb-1 font-semibold">{t("errors.offlineTitle")}</h2>
      <p class="text-sm text-muted-foreground">{t("errors.offlineBody")}</p>
    {:else}
      <TriangleAlert class="mx-auto mb-3 size-8 text-destructive" />
      <h2 class="mb-1 font-semibold">{t("errors.loadFailedTitle")}</h2>
      <p class="break-words text-sm text-muted-foreground">{error.message}</p>
      {#if retry}
        <Button class="mt-4" variant="outline" onclick={retry}>{t("common.retry")}</Button>
      {/if}
    {/if}
  </div>
{:else if loading}
  <div class="flex h-[60vh] items-center justify-center gap-2 text-muted-foreground">
    <Loader class="size-4 animate-spin" />
    <span class="text-sm">{t("common.loading")}</span>
  </div>
{:else}
  {@render children()}
{/if}
