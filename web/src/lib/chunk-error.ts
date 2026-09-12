/**
 * Detecting a stale-chunk import failure after a deploy lands mid-session.
 *
 * This is the surviving half of the React app's `lazyWithRetry`. SvelteKit does
 * its own recovery — when a module import fails during a client-side
 * navigation it falls back to a full page load, which fetches the fresh
 * manifest — so the retry wrapper is gone. The DETECTION stays, because
 * `hooks.client.ts` still has to tell "your app shell is stale" apart from "the
 * app crashed", and those need different messages.
 *
 * The reason this is not just a `fetch failed` check is worth keeping:
 *
 * A request for a hashed chunk that no longer exists does NOT 404 on either
 * host this app runs on. Cloudflare's `not_found_handling:
 * "single-page-application"` and Tauri's `get_asset()` fallback both answer
 * with index.html at **HTTP 200** and `Content-Type: text/html`. The browser
 * then rejects it on MIME type rather than status, and the resulting message
 * looks nothing like a network failure — so a status- or fetch-based check
 * silently stops recognising the one case that actually happens here.
 */

const RELOAD_FLAG = "f2p:chunk-reload";

/** Message shapes across Chromium, Firefox and WebKit. The last two are the
 *  MIME-type case described above; the rest are outright network failures. */
const CHUNK_LOAD_ERROR_RE =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to load module script|expected a javascript module script/i;

export function isChunkLoadError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return CHUNK_LOAD_ERROR_RE.test(message);
}

/**
 * Reload once per tab to pick up the new deploy.
 *
 * sessionStorage, not localStorage: the flag must NOT survive the tab. If it
 * did, a genuinely broken deploy would be reloaded past exactly once and then
 * never show its error UI again.
 *
 * Returns true if a reload was started, so the caller can keep a loading state
 * up rather than flashing an error the user will never read.
 */
export function reloadOnceForStaleChunk(): boolean {
  // Tauri webviews and lockdown modes can block storage entirely. Treat a
  // throw as "already retried" and degrade to showing the error, rather than
  // risking a reload loop.
  let alreadyTried = true;
  try {
    alreadyTried = sessionStorage.getItem(RELOAD_FLAG) !== null;
  } catch {
    return false;
  }
  if (alreadyTried) return false;

  try {
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Called after a successful navigation, so the next stale deploy gets its own
 *  single retry rather than inheriting a spent flag. */
export function clearStaleChunkFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
