<script lang="ts">
  /**
   * Toasts for the installable web app: going offline and back, a new version
   * waiting, the app shell becoming available offline, and installation.
   * Renders nothing itself. Web only - pwa-state.svelte.ts never starts in the
   * packaged apps.
   */
  import { toast } from "svelte-sonner";
  import { pwa } from "../pwa-state.svelte";
  import { i18n } from "../i18n.svelte";

  const t = i18n.t;

  // Only CHANGES are announced. The first run of each effect records the state
  // the page loaded in, so an offline start does not also claim "back online".
  let lastOnline: boolean | undefined;
  $effect(() => {
    const online = pwa.online;
    if (lastOnline !== undefined && online !== lastOnline) {
      if (online) toast.success(t("pwa.backOnline"));
      else toast.warning(t("pwa.wentOffline"));
    }
    lastOnline = online;
  });

  $effect(() => {
    if (!pwa.needRefresh) return;
    toast.info(t("pwa.updateAvailable"), {
      id: "pwa-update",
      description: t("pwa.updateBody"),
      duration: Number.POSITIVE_INFINITY,
      action: { label: t("pwa.reload"), onClick: () => void pwa.applyUpdate() },
    });
  });

  $effect(() => {
    if (pwa.offlineReady) toast.success(t("pwa.offlineReady"), { id: "pwa-offline-ready" });
  });

  $effect(() => {
    if (pwa.installed) toast.success(t("pwa.installed"), { description: t("pwa.installedBody") });
  });
</script>
