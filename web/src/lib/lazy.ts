import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * React.lazy wrapper that survives a deploy happening mid-session.
 *
 * After a new deploy the old hashed chunk files are gone; a user with a stale
 * app shell who navigates to a not-yet-loaded route gets a network/import
 * error. We auto-reload ONCE per tab (sessionStorage flag — must not survive
 * the tab, or a genuinely broken deploy would never surface its error UI).
 * The reload also picks up the waiting service worker, so the second attempt
 * imports from the fresh precache. A second failure throws to the nearest
 * ErrorBoundary.
 */

const RELOAD_FLAG = "f2p:chunk-reload";

/** Detects "failed to fetch dynamically imported module" / chunk 404s. */
export function isChunkLoadError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(
      err.message,
    )
  );
}

// Tauri webviews / lockdown modes can block sessionStorage — degrade to
// "no retry" rather than crashing the lazy factory.
function getFlag(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) !== null;
  } catch {
    return true; // pretend already retried → skip the reload path
  }
}

function setFlag(): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    /* ignore */
  }
}

function clearFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* ignore */
  }
}

export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await importer();
      clearFlag();
      return mod;
    } catch (err) {
      if (isChunkLoadError(err) && !getFlag()) {
        setFlag();
        window.location.reload();
        // Keep the Suspense fallback up while the reload happens.
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
