import { isTauri } from "./external-open";

/**
 * Remove any service worker the packaged apps picked up from an earlier build.
 *
 * WHY THE PACKAGED APPS MUST NOT HAVE ONE
 * A service worker registered at tauri.localhost can never be updated. Measured
 * on a real 2.0.0 release build, over CDP, in the webview:
 *
 *   TypeError: Failed to update a ServiceWorker for scope
 *   ('http://tauri.localhost/') with script ('http://tauri.localhost/sw.js'):
 *   An unknown error occurred when fetching the script.
 *
 * The update algorithm refetches the worker script bypassing the worker itself,
 * and Tauri's custom protocol does not satisfy it. So the worker installed by
 * whatever version the user ran FIRST keeps answering every navigation from its
 * precache, permanently.
 *
 * That is not theoretical. The 2.0.0 desktop build launched showing the React
 * app: the new window size, the old UI - a sidebar reading "Steam · v1.0" with
 * no Stats or Developers entries - because index.html itself came from the old
 * precache. Every future release would have shipped invisible.
 *
 * A worker buys the packaged apps nothing anyway. Their assets are already
 * local files served by the custom protocol, so there is no network to save;
 * offline DATA comes from the IndexedDB cache in cache.ts, which is where the
 * catalogue has always been kept. The worker's only effect here is the failure
 * mode above.
 *
 * The build no longer generates one for Tauri (see vite.config.ts), so this
 * exists for users upgrading from a build that did. It also drops the Workbox
 * precache: unregistering alone leaves tens of megabytes of a dead app behind.
 *
 * The data cache is deliberately kept - it is still valid, still keyed the same
 * way, and dropping it would make the first launch after an upgrade re-download
 * the whole catalogue.
 */
export async function purgeTauriServiceWorker(): Promise<void> {
  if (!isTauri() || !("serviceWorker" in navigator)) return;

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));

    if ("caches" in globalThis) {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("workbox-")).map((n) => caches.delete(n)),
      );
    }

    // Unregistering does not evict the page the old worker already served, so
    // without this the user keeps looking at the stale shell until they
    // relaunch. Only reload when there WAS a worker, or every start loops.
    if (regs.length > 0) location.reload();
  } catch {
    // Best effort. A failure here leaves the app exactly as it was, which is
    // the status quo, so there is nothing useful to report to the user.
  }
}
