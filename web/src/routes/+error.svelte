<script lang="ts">
  import { page } from "$app/state";
  import ErrorView from "$lib/common/ErrorView.svelte";
  import { isChunkLoadError } from "$lib/chunk-error";

  // SvelteKit's own error boundary. A 404 from the router, a load() throw, or
  // a failed lazy import all land here.
  //
  // 503 for a stale chunk: the app shell is out of date after a deploy, which
  // is a "come back in a moment" rather than a crash, and the 503 copy says
  // exactly that.
  const stale = $derived(isChunkLoadError(page.error?.message));
  const code = $derived(stale ? "503" : page.status === 404 ? "404" : "500");
</script>

<ErrorView code={code as never} detail={stale ? undefined : page.error?.message} />
