/**
 * NOT prerendered.
 *
 * The plan proposed prerendering all ~3,600 game pages for SEO from a
 * build-time read of ../data/*.jsonl. That is deferred rather than done,
 * deliberately:
 *
 *   - The Tauri build would have to skip it anyway (3,600 HTML files is real
 *     APK weight), so it needs a build-mode split before it is safe.
 *   - Every prerendered page would go stale against the daily data commits,
 *     which do NOT trigger a rebuild - that is the whole reason data is proxied
 *     at /api/data/* rather than bundled. Only the slow-changing fields could
 *     be baked in, with players and reviews hydrated client-side.
 *
 * Until that split exists these are served by the SPA fallback and rendered
 * from the catalogue the client already holds, which is correct - just not
 * indexable.
 */
export const prerender = false;
