<script lang="ts">
  import Badge, { type BadgeVariant } from "../../../src/lib/ui/Badge.svelte";
  import { STATUS_HELP } from "../lib/labels";

  type Props = { status: string; kind?: "queue" | "job"; class?: string };
  let { status, kind = "queue", class: className }: Props = $props();

  const QUEUE: Record<string, BadgeVariant> = {
    pending: "info",
    deferred: "secondary",
    approved: "default",
    committed: "success",
    // A failed ROW can be decided again, so it is a warning rather than an error.
    failed: "warning",
    rejected: "destructive",
  };
  const JOB: Record<string, BadgeVariant> = {
    pending: "info",
    committed: "success",
    conflict: "warning",
    failed: "destructive",
  };

  const JOB_HELP: Record<string, string> = {
    pending: "Started, and no result was recorded. The Worker may have stopped mid-commit.",
    committed: "The commit landed, or there was nothing to commit.",
    conflict: "The file changed underneath the commit on every attempt.",
    failed: "The commit was refused or GitHub could not be reached. Nothing was written.",
  };

  const variant = $derived((kind === "job" ? JOB : QUEUE)[status] ?? "outline");
  const help = $derived(kind === "job" ? JOB_HELP[status] : STATUS_HELP[status]);
</script>

<Badge {variant} class={className} title={help}>{status}</Badge>
