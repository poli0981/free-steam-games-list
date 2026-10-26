import { defineParams } from "@sveltejs/kit/params";
// `.ts`, not the `.js` every other #lib import uses: `vite build` loads this
// file with Node's own import(), not through Vite, and Node maps no extension.
// Everything it imports must load that way too (lib/legal.ts says so).
import { isLegalDocSlug } from "#lib/legal.ts";

/**
 * Route param matchers. SvelteKit 3 reads them from this one file; until then
 * each was a file of its own under src/params/.
 */
export const params = defineParams({
  /**
   * /legal/<slug> matches only a real document.
   *
   * Without it, /legal/nope was answered by the host's fallback (the
   * prerendered dashboard) and hydrated as the doc route with no data.
   * Unmatched, it lands in the layout's `page.route.id === null` branch and
   * shows the translated 404.
   */
  legaldoc: (param) => (isLegalDocSlug(param) ? param : undefined),
});
