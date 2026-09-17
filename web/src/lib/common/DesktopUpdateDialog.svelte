<script lang="ts">
  /**
   * Offers a desktop update, once per session, a few seconds after launch.
   * Renders nothing unless an update exists (lib/desktop-update.ts).
   */
  import { Dialog } from "bits-ui";
  import Download from "@lucide/svelte/icons/download";
  import { i18n } from "../i18n.svelte";
  import { consent } from "../prefs.svelte";
  import { checkDesktopUpdate, type DesktopUpdate } from "../desktop-update";
  import Button from "../ui/Button.svelte";

  const t = i18n.t;

  let update = $state<DesktopUpdate | null>(null);
  let open = $state(false);
  let phase = $state<"offer" | "installing" | "failed">("offer");
  let downloaded = $state(0);
  let total = $state<number | null>(null);
  let failure = $state("");

  // After consent, like every other network request the app makes, and after
  // a short delay so the check never competes with the catalogue load.
  $effect(() => {
    if (!consent.accepted) return;
    const timer = setTimeout(async () => {
      const found = await checkDesktopUpdate();
      if (found) {
        update = found;
        open = true;
      }
    }, 5000);
    return () => clearTimeout(timer);
  });

  const percent = $derived(total ? Math.min(100, Math.round((downloaded / total) * 100)) : null);

  async function install() {
    if (!update || phase === "installing") return;
    phase = "installing";
    try {
      await update.install((d, tot) => {
        downloaded = d;
        total = tot;
      });
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      phase = "failed";
    }
  }
</script>

{#if update}
  <Dialog.Root bind:open>
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <!-- Not dismissible mid-install: closing the dialog would hide progress
           for a download that keeps running. -->
      <Dialog.Content
        escapeKeydownBehavior={phase === "installing" ? "ignore" : "close"}
        interactOutsideBehavior={phase === "installing" ? "ignore" : "close"}
        class="fixed left-1/2 top-1/2 z-50 w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-2xl"
      >
        <div class="flex items-start gap-3">
          <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <Download class="size-5" />
          </span>
          <div class="min-w-0">
            <Dialog.Title class="font-display text-lg font-semibold">
              {t("appUpdate.desktopTitle", { version: update.version })}
            </Dialog.Title>
            <Dialog.Description class="mt-1 text-sm text-muted-foreground">
              {t("appUpdate.desktopBody", { current: update.currentVersion })}
            </Dialog.Description>
          </div>
        </div>

        {#if update.body}
          <!-- Plain text, never {@html}: release notes come from a file on
               GitHub, and this window can reach native APIs. -->
          <p class="mt-4 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-background p-3 text-xs text-muted-foreground">
            {update.body}
          </p>
        {/if}

        {#if phase === "installing"}
          <div class="mt-4" role="status" aria-live="polite">
            <div class="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-primary transition-[width]"
                style:width={percent === null ? "35%" : `${percent}%`}
              ></div>
            </div>
            <p class="mt-2 text-xs text-muted-foreground tnum">
              {percent === null ? t("appUpdate.installing") : t("appUpdate.downloading", { percent })}
            </p>
          </div>
        {:else if phase === "failed"}
          <p class="mt-4 text-sm text-destructive" role="alert">{t("appUpdate.failed", { error: failure })}</p>
        {/if}

        <div class="mt-6 flex justify-end gap-2">
          <Button variant="ghost" disabled={phase === "installing"} onclick={() => (open = false)}>
            {t("appUpdate.later")}
          </Button>
          <Button disabled={phase === "installing"} onclick={install}>
            {t(phase === "failed" ? "common.retry" : "appUpdate.installRestart")}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
{/if}
