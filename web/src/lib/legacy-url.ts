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
 *   - A REPLACING navigation. A pushing one would leave the old URL in history,
 *     so Back would bounce the reader straight to the hash URL and round
 *     again.
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
import { goto } from "$app/navigation";

export function upgradeLegacyHashUrl(): void {
  if (typeof window === "undefined") return;
  const { hash, origin } = window.location;
  if (!hash.startsWith("#/")) return;
  // The hash is anyone's to write. Resolved against this origin and checked
  // against it, because `#//other.example/…` (or `#/\other.example`) names
  // another site, and an old link is never a reason to leave this one.
  const url = new URL(hash.slice(1), origin);
  if (url.origin !== origin) return;
  // goto, not history.replaceState. By the time this runs the router has
  // already rendered the document it was given - "/", the dashboard - and a
  // bare replaceState changed the address bar while leaving the dashboard on
  // screen. goto renders the route the hash names; replace keeps the hash URL
  // out of history, so Back does not bounce through it.
  //
  // goto rejects a path that matches no route (SvelteKit 3; SvelteKit 2 loaded
  // it natively). Such a link gets the 404 page at its fixed address: nothing
  // from the hash ever reaches a navigation that bypasses the router.
  void goto(url, { replace: true, reset: false }).catch(() => goto("/error/404", { replace: true }));
}
