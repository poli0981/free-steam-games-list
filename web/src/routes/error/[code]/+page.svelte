<script lang="ts">
  import { page } from "$app/state";
  import ErrorView, { isErrorCode } from "$lib/common/ErrorView.svelte";

  // An unknown code falls back to 404 IN PLACE rather than redirecting: a
  // redirect would replace the URL the user was sent, which is exactly the
  // thing they would quote in a bug report.
  const code = $derived(isErrorCode(page.params.code ?? "") ? page.params.code : "404");
</script>

<!-- No <Seo> here on purpose: ErrorView owns this route's head, emitting a
     title and robots=noindex. A second <title> would win or lose by DOM
     order, and an error page needs neither a social card nor a canonical
     URL pointing at the path that just failed. -->
<ErrorView code={code as never} />
