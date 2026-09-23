<script lang="ts">
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { page } from "$app/state";
  import { consent } from "../consent.svelte";
  import { humanCheck } from "../human-check-state.svelte";
  import { replyOutcome, siteKeyFor, widgetFault } from "../human-check";
  import { loadTurnstile, type TurnstileApi } from "../turnstile";
  import { isUngatedPath } from "../gates";
  import { theme } from "../prefs.svelte";
  import { i18n } from "../i18n.svelte";
  import { legalDocSlug } from "../legal";
  import { HUMAN_CHECK_ACTION, HUMAN_CHECK_PATH, type HumanCheckReply } from "../../../shared/human-check";
  import Button from "../ui/Button.svelte";

  /**
   * The Turnstile human check - WEB ONLY, after the consent gate.
   *
   * An OVERLAY, for the consent gate's reason: the page underneath is the
   * prerendered content crawlers index, and it must stay in the HTML. It opens
   * only once humanCheck has read storage, so it is never baked into a page,
   * and never together with ConsentGate (it needs consent.accepted; that gate
   * needs its absence). Crawlers never consent, so they never see this.
   *
   * What it protects, and what it cannot, is in lib/human-check.ts.
   */

  const t = i18n.t;
  const PRIVACY_HREF = `/legal/${legalDocSlug("docs/PRIVACY_POLICY.md")}`;

  const open = $derived(
    consent.accepted && humanCheck.hydrated && !humanCheck.cleared && !isUngatedPath(page.url.pathname),
  );

  type Status = "loading" | "ready" | "confirming" | "failed" | "blocked" | "unsupported";
  let status = $state<Status>("loading");
  let code = $state<string | null>(null);
  /** Bumped by Retry after api.js failed to load, to run the effect again. */
  let attempt = $state(0);
  let host = $state<HTMLDivElement>();

  let api: TurnstileApi | null = null;
  let widgetId: string | undefined;

  $effect(() => {
    if (!open || !host) return;
    void attempt;
    const el = host;
    let live = true;
    status = "loading";
    code = null;

    loadTurnstile().then(
      (ts) => {
        if (!live) return;
        api = ts;
        // Theme and language are read here, in a callback, so changing either
        // does not re-render the widget: that would restart the challenge, and
        // both controls sit under this overlay anyway.
        widgetId = ts.render(el, {
          sitekey: siteKeyFor(location.hostname),
          action: HUMAN_CHECK_ACTION,
          theme: theme.resolved,
          language: i18n.lang,
          // "flexible" needs 300 px; a narrow phone gets the compact widget.
          size: el.clientWidth >= 300 ? "flexible" : "compact",
          appearance: "always",
          "response-field": false,
          callback: (token) => void confirm(token),
          "error-callback": (c) => {
            onWidgetError(String(c));
            return true;
          },
          // No expired-callback: the token is posted the moment it arrives,
          // and refresh-expired's default ("auto") renews one that is not.
          "unsupported-callback": () => {
            status = "unsupported";
          },
        });
        if (status === "loading") status = "ready";
      },
      () => {
        if (!live) return;
        // Offline there is nothing to protect, and the installed app must still
        // open. Online, something stopped challenges.cloudflare.com - say so.
        if (!navigator.onLine) humanCheck.waive();
        else status = "blocked";
      },
    );

    return () => {
      live = false;
      if (widgetId !== undefined) {
        try {
          api?.remove(widgetId);
        } catch {
          /* the frame is already gone */
        }
      }
      widgetId = undefined;
    };
  });

  async function confirm(token: string): Promise<void> {
    status = "confirming";
    code = null;
    let res: Response;
    try {
      res = await fetch(HUMAN_CHECK_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
    } catch (err) {
      // The site itself is unreachable: that is not the reader's failure.
      console.error("human-check: could not reach the site to verify", err);
      humanCheck.waive();
      return;
    }
    const reply = (await res.json().catch(() => null)) as HumanCheckReply | null;
    switch (replyOutcome(res.status, reply)) {
      case "pass":
        humanCheck.markPassed(reply?.ttl);
        break;
      case "refused":
        status = "failed";
        code = reply?.codes?.[0] ?? null;
        break;
      case "waive":
        console.error("human-check: the site could not verify the check", res.status, reply?.error);
        humanCheck.waive();
        break;
    }
  }

  function onWidgetError(c: string): void {
    if (widgetFault(c) === "config") {
      // Our setup is wrong (or the page is being viewed through a proxy on
      // another hostname). Never the reader's fault, so never their lockout.
      console.error(`human-check: Turnstile configuration error ${c}`);
      humanCheck.waive();
      return;
    }
    status = "failed";
    code = c;
  }

  function retry(): void {
    if (status === "blocked" || !api || widgetId === undefined) {
      attempt += 1;
      return;
    }
    status = "ready";
    code = null;
    // A fresh challenge; its token arrives through the same callback.
    api.reset(widgetId);
  }
</script>

{#if open}
  <div class="fixed inset-0 z-[60] flex items-center justify-center overflow-auto bg-background/95 p-4 backdrop-blur-sm">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="human-check-title"
      aria-describedby="human-check-intro"
      class="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl sm:p-8"
    >
      <div class="mb-5 flex items-start gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <ShieldCheck class="size-5" />
        </span>
        <div>
          <h1 id="human-check-title" class="text-xl font-semibold">{t("humanCheck.title")}</h1>
          <p id="human-check-intro" class="mt-1 text-sm text-muted-foreground">{t("humanCheck.intro")}</p>
        </div>
      </div>

      <!-- Turnstile renders its iframe in here. -->
      <div bind:this={host} class="flex min-h-[65px] w-full justify-center"></div>

      <div class="mt-3 min-h-5 text-sm" role="status" aria-live="polite">
        {#if status === "loading"}
          <p class="text-muted-foreground">{t("common.loading")}</p>
        {:else if status === "confirming"}
          <p class="text-muted-foreground">{t("humanCheck.confirming")}</p>
        {:else if status === "failed"}
          <p class="text-destructive">{t("humanCheck.failed")}</p>
        {:else if status === "blocked"}
          <p class="text-destructive">{t("humanCheck.blocked")}</p>
        {:else if status === "unsupported"}
          <p class="text-destructive">{t("humanCheck.unsupported")}</p>
        {/if}
        {#if code}
          <p class="mt-1 text-xs text-muted-foreground">{t("humanCheck.errorCode", { code })}</p>
        {/if}
      </div>

      {#if status === "failed" || status === "blocked"}
        <Button class="mt-4" variant="outline" onclick={retry}>{t("common.retry")}</Button>
      {/if}

      <p class="mt-5 text-xs text-muted-foreground">
        {t("humanCheck.privacyNote")}
        <a href={PRIVACY_HREF} class="text-primary underline-offset-2 hover:underline">{t("legal.docs.privacy.label")}</a>
      </p>
    </div>
  </div>
{/if}
