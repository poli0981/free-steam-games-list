/**
 * Server hooks. adapter-static has no server at runtime, so this only ever
 * runs while the site is BUILT (prerender) and under `vite dev`.
 *
 * One job: /img/* and /api/* are Worker routes (wrangler.jsonc
 * run_worker_first) that this app does not contain. The prerender crawler
 * follows every `src`, and each game page carries an <img src="/img/...">, so
 * every build asked the app for ~5,600 of them. Each request rendered the root
 * layout plus the error page, and SvelteKit's default handleError printed a
 * `[404] GET /img/...` line for it - 91% of the Workers Builds log, burying
 * anything worth reading. Answering before routing skips both.
 *
 * The prerenderer still sees a 404. `kit.prerender.handleHttpError`
 * (svelte.config.js) ignores it for exactly these two prefixes and fails the
 * build for any other path, so a genuinely broken internal link still stops
 * the build.
 *
 * `vite dev` never gets here for these paths: its proxy (vite.config.ts)
 * forwards /api and /img to production before SvelteKit's middleware runs.
 */
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = ({ event, resolve }) => {
  // Same prefixes, same test, as handleHttpError in svelte.config.js.
  const { pathname } = event.url;
  if (pathname.startsWith("/img/") || pathname.startsWith("/api/")) {
    return new Response(null, { status: 404 });
  }
  return resolve(event);
};
