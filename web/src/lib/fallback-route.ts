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
 * A route in MAY_FALL_BACK can arrive as the substituted shell. Whether it DID
 * is answered by the page itself: each of these pages calls
 * markRouteRendered() from its top-level script, which runs while hydrating -
 * before the layout's onMount calls recoverFallbackRoute(). If the page that
 * hydrated is not the route's own, nothing marked it, and the router is asked
 * to render the URL it already knows it is on.
 *
 * That distinction became necessary when game pages started being
 * prerendered on the web. /games/730 is now normally its own document and must
 * NOT be re-rendered - but a game added after the last deploy has no file, the
 * Tauri build prerenders none, and studio pages never are, so all of those
 * still fall back.
 *
 * Only on first mount. A later client-side navigation renders these routes
 * correctly on its own, and re-running this would loop.
 */
const MAY_FALL_BACK = new Set([
  "/games/[appid]",
  "/developers/[name]",
  "/publishers/[name]",
]);

let rendered: string | null = null;

/** Called by each MAY_FALL_BACK page from its top-level script. */
export function markRouteRendered(routeId: string): void {
  rendered = routeId;
}

export function recoverFallbackRoute(routeId: string | null): void {
  if (!routeId || !MAY_FALL_BACK.has(routeId)) return;
  // The route's own page hydrated: it was a real (prerendered) document.
  if (rendered === routeId) return;

  // invalidateAll so the route's own load() runs; without it SvelteKit can
  // reuse the shell's `data: [null, null]`. replaceState so the shell does not
  // become a Back-button stop, and noScroll because the user has not moved.
  void goto(location.pathname + location.search + location.hash, {
    replaceState: true,
    noScroll: true,
    invalidateAll: true,
  });
}

/** The list above, exported so a test can hold it against the route files. */
export const MAY_FALL_BACK_ROUTES: ReadonlySet<string> = MAY_FALL_BACK;
