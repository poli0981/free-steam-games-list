<!--
  The moving parts, checked live. The table renders on a 503 too: the old page
  threw on the status code and showed nothing, exactly when something was wrong.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Send from "@lucide/svelte/icons/send";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Button from "../../../src/lib/ui/Button.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  import { api, errorMessage, SessionExpiredError } from "../lib/api";
  import { isAbort, reportError } from "../lib/notify";
  import { router } from "../lib/router.svelte";
  import { exactTime, formatInt, relativeTime } from "../lib/format";
  import { QUEUE_STATUSES } from "../../../shared/queue-rules";
  import { ADMIN_MIGRATIONS, type HealthResponse } from "../../../shared/admin-api";

  let health = $state.raw<HealthResponse | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let refresh = $state(0);
  let pinging = $state(false);

  $effect(() => {
    void refresh;
    const controller = new AbortController();
    untrack(() => {
      loading = true;
      loadError = null;
    });
    api<HealthResponse>("health", { signal: controller.signal, accept: [503] })
      .then((h) => {
        health = h;
        loading = false;
      })
      .catch((err) => {
        if (isAbort(err)) return;
        loading = false;
        loadError = errorMessage(err);
        if (err instanceof SessionExpiredError) reportError(err);
      });
    return () => controller.abort();
  });

  const missing = $derived(
    health?.migrations ? ADMIN_MIGRATIONS.filter((m) => !health!.migrations!.includes(m)) : [],
  );

  async function ping() {
    pinging = true;
    try {
      await api("ping", { method: "POST" });
      toast.success("Write path works", {
        description: "A ping row was written to the audit log.",
        action: { label: "Open audit log", onClick: () => router.navigate("/admin/audit?action=ping") },
      });
    } catch (err) {
      reportError(err, "The test write failed");
    } finally {
      pinging = false;
    }
  }
</script>

{#snippet state(ok: boolean | null, text: string)}
  <span class="inline-flex items-center gap-1.5 {ok === true ? 'text-success' : ok === false ? 'text-destructive' : 'text-warning'}">
    {#if ok === true}<CircleCheck class="size-4" />{:else if ok === false}<CircleX class="size-4" />{:else}<TriangleAlert class="size-4" />{/if}
    {text}
  </span>
{/snippet}

<section class="space-y-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Health</h1>
      <p class="text-sm text-muted-foreground">Checked live against D1 and the GitHub App each time this page loads.</p>
    </div>
    <div class="flex gap-2">
      <Button variant="outline" size="sm" onclick={ping} disabled={pinging}>
        {#if pinging}<LoaderCircle class="size-4 animate-spin" />{:else}<Send class="size-4" />{/if}
        Test write
      </Button>
      <Button variant="outline" size="sm" onclick={() => refresh++} disabled={loading}>
        <RefreshCw class="size-4 {loading ? 'animate-spin' : ''}" /> Refresh
      </Button>
    </div>
  </div>

  {#if loadError && !health}
    <p class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">{loadError}</p>
  {:else if !health}
    <div class="h-64 animate-pulse rounded-lg bg-muted" aria-busy="true"></div>
  {:else}
    <div
      class="flex items-center gap-3 rounded-lg border p-4 {health.ok
        ? 'border-success/40 bg-success/10'
        : 'border-destructive/40 bg-destructive/10'}"
      class:opacity-60={loading}
      role="status"
    >
      {#if health.ok}
        <CircleCheck class="size-5 text-success" />
        <p class="font-medium">Everything the admin depends on is working.</p>
      {:else}
        <CircleX class="size-5 text-destructive" />
        <p class="font-medium">Something needs attention. The rows below say what.</p>
      {/if}
    </div>

    <div class="overflow-hidden rounded-lg border border-border" class:opacity-60={loading}>
      <table class="w-full text-sm">
        <tbody class="divide-y divide-border">
          <tr>
            <th scope="row" class="w-48 bg-muted/40 px-4 py-3 text-left font-medium">Signed in as</th>
            <td class="px-4 py-3 break-all">{health.actor}</td>
          </tr>
          <tr>
            <th scope="row" class="bg-muted/40 px-4 py-3 text-left font-medium">D1 database</th>
            <td class="px-4 py-3">
              {#if health.d1 === "ok"}
                {@render state(true, "reachable")}
              {:else}
                {@render state(false, "unreachable")}
                <p class="mt-1 text-xs text-muted-foreground">The error is in Workers Logs (wrangler tail).</p>
              {/if}
            </td>
          </tr>
          <tr>
            <th scope="row" class="bg-muted/40 px-4 py-3 text-left font-medium">GitHub App</th>
            <td class="px-4 py-3">
              {#if health.github === "ok"}
                {@render state(true, "installation and permissions work")}
              {:else}
                {@render state(false, health.github === "error" ? "request failed" : `GitHub answered ${health.github ?? "nothing"}`)}
                <p class="mt-1 text-xs text-muted-foreground">
                  Approvals and corrections cannot commit until this works. Check the App's private key, installation
                  and repository permissions (docs/ADMIN.md).
                </p>
              {/if}
            </td>
          </tr>
          <tr>
            <th scope="row" class="bg-muted/40 px-4 py-3 text-left font-medium">Migrations</th>
            <td class="px-4 py-3">
              {#if health.migrations === null || health.migrations === undefined}
                {@render state(null, "could not be read")}
              {:else if missing.length}
                {@render state(null, `${missing.length} not applied: ${missing.join(", ")}`)}
                <p class="mt-1 text-xs text-muted-foreground">
                  The admin still works, without the reconcile lock and sweep watermark. Apply them with
                  <code class="rounded bg-muted px-1 font-mono">npx wrangler d1 migrations apply f2p-admin --remote</code>.
                </p>
              {:else}
                {@render state(true, `all ${health.migrations.length} applied`)}
              {/if}
            </td>
          </tr>
          <tr>
            <th scope="row" class="bg-muted/40 px-4 py-3 text-left font-medium">Reconcile lock</th>
            <td class="px-4 py-3">
              {#if health.lock}
                <span title={exactTime(health.lock.expires_at)}>
                  held by <span class="font-mono text-xs">{health.lock.owner}</span>, expires {relativeTime(health.lock.expires_at)}
                </span>
              {:else}
                <span class="text-muted-foreground">free</span>
              {/if}
            </td>
          </tr>
          <tr>
            <th scope="row" class="bg-muted/40 px-4 py-3 text-left font-medium">History kept</th>
            <td class="px-4 py-3">{health.retentionDays} days of audit log and commit jobs</td>
          </tr>
          <tr>
            <th scope="row" class="bg-muted/40 px-4 py-3 text-left font-medium">Queue</th>
            <td class="px-4 py-3">
              {#if health.queue}
                <div class="flex flex-wrap gap-2">
                  {#each QUEUE_STATUSES as s (s)}
                    <a href={s === "pending" ? "/admin" : `/admin?status=${s}`} class="inline-flex items-center gap-1.5 hover:underline">
                      <StatusBadge status={s} />
                      <span class="tnum">{formatInt(health.queue[s] ?? 0)}</span>
                    </a>
                  {/each}
                </div>
              {:else}
                <span class="text-muted-foreground">unavailable</span>
              {/if}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  {/if}
</section>
