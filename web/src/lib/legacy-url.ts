/**
 * Every link from the HashRouter era is `/#/games/730`.
 *
 * Released desktop and Android builds up to 1.4.5 used hash routing, so
 * bookmarks made from them, links shared out of them, and anything a search
 * engine indexed before the BrowserRouter migration all carry that shape.
 * Rewriting it keeps those working.
 *
 * Two details that are easy to get wrong:
 *
 *   - Only `#/…` is rewritten. An in-page anchor like `#vac` must survive, or
 *     every deep link into a long document breaks instead.
 *   - `replaceState`, not a navigation. A navigation would leave the old URL in
 *     history, so Back would bounce the reader straight to the hash URL and
 *     round again.
 *
 * Unlike the React version this is NOT skipped under Tauri. The packaged apps
 * now use real paths too — `tauri::manager::get_asset()` falls back to
 * index.html — so an old hash URL held by a 1.4.x install needs upgrading there
 * as much as on the web.
 *
 * Testing note, learned the hard way: navigating to `/#/games/730` from a tab
 * already on `/` is a same-document fragment change. No page load happens, so
 * load-time code never runs. Navigate via a different path first.
 */
export function upgradeLegacyHashUrl(): void {
  if (typeof window === "undefined") return;
  const { hash } = window.location;
  if (!hash.startsWith("#/")) return;
  window.history.replaceState(window.history.state, "", hash.slice(1) || "/");
}
