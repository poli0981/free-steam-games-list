<script lang="ts" module>
  import type { Component } from "svelte";
  import ShieldX from "@lucide/svelte/icons/shield-x";
  import FileQuestion from "@lucide/svelte/icons/file-question-mark";
  import ServerCrash from "@lucide/svelte/icons/server-crash";
  import Network from "@lucide/svelte/icons/network";
  import CloudOff from "@lucide/svelte/icons/cloud-off";
  import Hourglass from "@lucide/svelte/icons/hourglass";
  import WifiOff from "@lucide/svelte/icons/wifi-off";

  export const ERROR_CODES = [
    "403",
    "404",
    "500",
    "502",
    "503",
    "504",
    "offline",
  ] as const;
  export type ErrorCode = (typeof ERROR_CODES)[number];

  export function isErrorCode(v: string): v is ErrorCode {
    return (ERROR_CODES as readonly string[]).includes(v);
  }

  /**
   * Title and description are LITERAL keys rather than `errors.${code}.title`,
   * so i18n.test.ts can see every key this component asks for.
   */
  const META: Record<
    ErrorCode,
    {
      icon: Component<{ class?: string }>;
      tone: "neutral" | "warn" | "destructive";
      title: string;
      description: string;
    }
  > = {
    "403": { icon: ShieldX, tone: "warn", title: "errors.403.title", description: "errors.403.description" },
    "404": { icon: FileQuestion, tone: "neutral", title: "errors.404.title", description: "errors.404.description" },
    "500": { icon: ServerCrash, tone: "destructive", title: "errors.500.title", description: "errors.500.description" },
    "502": { icon: Network, tone: "destructive", title: "errors.502.title", description: "errors.502.description" },
    "503": { icon: CloudOff, tone: "destructive", title: "errors.503.title", description: "errors.503.description" },
    "504": { icon: Hourglass, tone: "destructive", title: "errors.504.title", description: "errors.504.description" },
    offline: { icon: WifiOff, tone: "warn", title: "errors.offline.title", description: "errors.offline.description" },
  };

  export const REPORT_ISSUE_URL =
    "https://github.com/poli0981/free-steam-games-list/issues/new";
</script>

<script lang="ts">
  import Home from "@lucide/svelte/icons/house";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Bug from "@lucide/svelte/icons/bug";
  import { i18n } from "../i18n.svelte";
  import Button from "../ui/Button.svelte";
  import { cn } from "../utils";

  let {
    code,
    detail,
    inline = false,
  }: {
    code: ErrorCode;
    detail?: string;
    /** Inside the app shell (the soft 404) rather than a full standalone page. */
    inline?: boolean;
  } = $props();

  const t = i18n.t;
  const meta = $derived(META[code]);
  const Icon = $derived(meta.icon);
</script>

<svelte:head>
  <title>{t(meta.title)} · Steam F2P Tracker</title>
  <!-- An error page must never be indexed as content. -->
  <meta name="robots" content="noindex" />
</svelte:head>

<div class={cn("flex items-center justify-center p-4", inline ? "min-h-[60vh]" : "min-h-dvh")}>
  <div class="w-full max-w-md text-center">
    <span
      class={cn(
        "mx-auto mb-5 grid size-14 place-items-center rounded-2xl",
        meta.tone === "destructive" && "bg-destructive/12 text-destructive",
        meta.tone === "warn" && "bg-warning/12 text-warning",
        meta.tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      <Icon class="size-7" />
    </span>

    <p class="font-mono text-xs uppercase tracking-widest text-muted-foreground">
      {code === "offline" ? t("errors.offline.badge") : t("errors.code", { code })}
    </p>
    <h1 class="mt-1 text-2xl font-semibold">{t(meta.title)}</h1>
    <p class="mt-2 text-sm text-muted-foreground">{t(meta.description)}</p>

    {#if detail}
      <pre
        class="mt-4 overflow-x-auto rounded-md border bg-card p-3 text-left font-mono text-xs
               text-muted-foreground">{detail}</pre>
    {/if}

    <div class="mt-6 flex flex-wrap justify-center gap-2">
      <Button href="/">
        <Home class="size-4" />
        {t("errors.actions.home")}
      </Button>
      <Button variant="outline" onclick={() => location.reload()}>
        <RotateCw class="size-4" />
        {t("errors.actions.reload")}
      </Button>
      <Button variant="ghost" href={REPORT_ISSUE_URL} target="_blank" rel="noreferrer">
        <Bug class="size-4" />
        {t("errors.actions.report")}
      </Button>
    </div>
  </div>
</div>
