<script lang="ts">
  import Compass from "@lucide/svelte/icons/compass";
  import EmptyState from "../components/EmptyState.svelte";
  import Button from "../../../src/lib/ui/Button.svelte";
  import { router } from "../lib/router.svelte";
</script>

<div class="rounded-lg border border-border">
  <EmptyState icon={Compass} title="No admin page at {router.path}">
    <p>The address may be mistyped.</p>
    <Button class="mt-4" variant="outline" size="sm" href="/admin">Go to the queue</Button>
  </EmptyState>
</div>
