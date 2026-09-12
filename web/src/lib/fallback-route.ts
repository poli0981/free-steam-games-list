import { goto } from "$app/navigation";

/**
 * Re-render the real page when the host answered with the fallback shell.
 *
 * THE PROBLEM
 * Three routes are deliberately not prerendered - see NOT_PRERENDERED below -
 * so a cold load of one has to be answered with an app shell. Both places this
 * app ships answer it with `index.html` specifically, and neither can be told
 * otherwise:
 *
 *   - Cloudflare: `not_found_handling: "single-page-application"` serves
 *     /index.html, and nothing configures which file that is. `_redirects`
 *     cannot substitute one either - Workers Static Assets has no 200-status
 *     rewrite, and a rule of `/games/* /200.html 200` is honoured as a
 *     REDIRECT: the address bar became /200 and the app 404ed. Measured.
 *   - Tauri: `tauri::manager::get_asset()` walks <path>.html, then
 *     <path>/index.html, then index.html. The chain is compiled in.
 *
 * And index.html is the PRERENDERED DASHBOARD, whose inline bootstrap carries
 * `node_ids: [0, 2]` - the layout and page components for "/". SvelteKit
 * hydrates exactly those.
 *
 * WHAT THAT LOOKS LIKE, AND WHY IT IS EASY TO MISS
 * The router is not confused: measured on /games/730, `page.route.id` is
 * "/games/[appid]" and page.url is correct, so <Seo> emits the right canonical
 * and og:url. Only the rendered COMPONENTS are the dashboard's. The page
 * therefore returns HTTP 200, logs nothing, and carries correct-looking
 * metadata - the single visible symptom is the wrong <h1>. An earlier version
 * of this file tested `route.id === "/"` for that reason and never fired.
 *
 * THE TEST THAT DOES WORK
 * These routes are never prerendered, so a document delivered for one of them
 * is always the substituted shell - there is no case where the initial HTML
 * legitimately belongs to the route. Hence: on first mount only, ask the
 * router to render the URL it already knows it is on.
 *
 * Only on first mount. A later client-side navigation renders these routes
 * correctly on its own, and re-running this would loop.
 */
const NOT_PRERENDERED = new Set([
  "/games/[appid]",
  "/developers/[name]",
  "/publishers/[name]",
]);

export function recoverFallbackRoute(routeId: string | null): void {
  if (!routeId || !NOT_PRERENDERED.has(routeId)) return;

  // invalidateAll so the route's own load() runs; without it SvelteKit can
  // reuse the shell's `data: [null, null]`. replaceState so the shell does not
  // become a Back-button stop, and noScroll because the user has not moved.
  void goto(location.pathname + location.search + location.hash, {
    replaceState: true,
    noScroll: true,
    invalidateAll: true,
  });
}

/** The list above, exported so a test can hold it against the routes that
 *  actually declare `prerender = false`. */
export const NOT_PRERENDERED_ROUTES: ReadonlySet<string> = NOT_PRERENDERED;
