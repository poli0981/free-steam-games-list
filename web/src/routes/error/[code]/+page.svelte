<script lang="ts">
  import { page } from "$app/state";
  import ErrorView, { isErrorCode } from "$lib/common/ErrorView.svelte";

  // An unknown code falls back to 404 IN PLACE rather than redirecting: a
  // redirect would replace the URL the user was sent, which is exactly the
  // thing they would quote in a bug report.
  const code = $derived(isErrorCode(page.params.code ?? "") ? page.params.code : "404");
</script>

<ErrorView code={code as never} />
