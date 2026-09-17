import { toast } from "svelte-sonner";
import { SessionExpiredError, errorMessage } from "./api";
import { commitUrl, shortSha } from "./format";

let reloading = false;
const RELOAD_KEY = "f2p-admin:session-reload";
const RELOAD_WINDOW_MS = 30_000;

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function reloadedRecently(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) < RELOAD_WINDOW_MS;
  } catch {
    return false;
  }
}

/**
 * The one place a failed request is reported.
 *
 * An expired Access session reloads the page: only a full navigation lets
 * Access redirect the document to its login flow. A fetch cannot follow it.
 * Once only: if the API still refuses straight after that reload, reloading
 * again would loop forever, so the reviewer is told instead.
 */
export function reportError(err: unknown, context?: string): void {
  if (isAbort(err)) return;
  if (err instanceof SessionExpiredError) {
    if (reloading) return;
    reloading = true;
    if (reloadedRecently()) {
      toast.error("The admin API still refuses this session", {
        description: "Reloading did not sign you in again. Open /admin in a new tab, or check the Access policy.",
        duration: Number.POSITIVE_INFINITY,
      });
      return;
    }
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      /* storage blocked: the reload still happens, just without the loop guard */
    }
    toast.error("Your Cloudflare Access session has expired. Reloading to sign in again…");
    setTimeout(() => location.reload(), 1200);
    return;
  }
  toast.error(context ?? "Request failed", { description: errorMessage(err) });
}

/** The outcome of an override commit, with a link to the commit when one was made. */
export function commitToast(title: string, sha: string | null | undefined, applied = true): void {
  toast.success(title, {
    description: sha
      ? `Commit ${shortSha(sha)}.${applied ? " data/ changes on the next pipeline run." : ""}`
      : "Nothing to commit: the override files already said this.",
    action: sha ? { label: "View commit", onClick: () => window.open(commitUrl(sha), "_blank", "noopener") } : undefined,
  });
}
