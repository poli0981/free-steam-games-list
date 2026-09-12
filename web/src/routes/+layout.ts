/**
 * Applies to every route.
 *
 * `ssr = false` — this is a static build with no server at runtime. Prerender
 * still runs the component once at build time to produce HTML; disabling SSR
 * here would give up that HTML, and with it the whole SEO reason for
 * prerendering. It stays ON.
 *
 * `prerender = true` — every route is prerendered by default. The one route
 * that opts out is /games/[appid] in the Tauri build, which sets its own value.
 */
export const prerender = true;

/**
 * No trailing slash, matching the URLs already in the wild: the Worker serves
 * /games/730, the sitemap lists paths without one, and released 1.4.x apps hold
 * /#/games/730 which upgrades to the same shape.
 */
export const trailingSlash = "never";
