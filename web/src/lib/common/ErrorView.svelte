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

  const META: Record<
    ErrorCode,
    { icon: Component<{ class?: string }>; tone: "neutral" | "warn" | "destructive" }
  > = {
    "403": { icon: ShieldX, tone: "warn" },
    "404": { icon: FileQuestion, tone: "neutral" },
    "500": { icon: ServerCrash, tone: "destructive" },
    "502": { icon: Network, tone: "destructive" },
    "503": { icon: CloudOff, tone: "destructive" },
    "504": { icon: Hourglass, tone: "destructive" },
    offline: { icon: WifiOff, tone: "warn" },
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

  let { code, detail }: { code: ErrorCode; detail?: string } = $props();

  const t = i18n.t;
  const meta = $derived(META[code]);
  const Icon = $derived(meta.icon);
</script>

<svelte:head>
  <title>{t(`errors.${code}.title`)} · Steam F2P Tracker</title>
  <!-- An error page must never be indexed as content. -->
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="flex min-h-dvh items-center justify-center p-4">
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
    <h1 class="mt-1 text-2xl font-semibold">{t(`errors.${code}.title`)}</h1>
    <p class="mt-2 text-sm text-muted-foreground">{t(`errors.${code}.description`)}</p>

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
