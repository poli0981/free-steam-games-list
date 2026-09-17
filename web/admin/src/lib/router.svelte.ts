/**
 * A history router for five pages. The admin has no nested routes, no route
 * parameters and no data loading to coordinate, so a framework router would be
 * all weight and no function.
 *
 * Page state that should survive a reload or a shared link (the queue's tab,
 * search, sort and page; the edit page's appid) lives in the query string and
 * is read and written through `query` and `setQuery`.
 */
import { isAdminRoute, type AdminRoute } from "../../../shared/admin-routes";

type Guard = () => string | null;

class Router {
  path = $state<string>(typeof location === "undefined" ? "/admin" : location.pathname);
  search = $state<string>(typeof location === "undefined" ? "" : location.search);

  /** Returns a confirmation message when leaving would lose work, else null. */
  #guards = new Set<Guard>();

  get route(): AdminRoute | null {
    return isAdminRoute(this.path) ? this.path : null;
  }

  get query(): URLSearchParams {
    return new URLSearchParams(this.search);
  }

  /** Register a leave-guard; returns its removal. */
  guard(fn: Guard): () => void {
    this.#guards.add(fn);
    return () => this.#guards.delete(fn);
  }

  #blocked(): boolean {
    for (const guard of this.#guards) {
      const message = guard();
      if (message && !confirm(message)) return true;
    }
    return false;
  }

  /**
   * Ask the leave-guards before discarding work that a path change would not
   * catch, such as loading a different game on the same page. True means go on.
   */
  confirmLeave(): boolean {
    return !this.#blocked();
  }

  navigate(to: string, options: { replace?: boolean; force?: boolean } = {}): void {
    const url = new URL(to, location.origin);
    if (url.pathname === this.path && url.search === this.search) return;
    if (!options.force && url.pathname !== this.path && this.#blocked()) return;
    history[options.replace ? "replaceState" : "pushState"](null, "", url.pathname + url.search);
    this.sync();
  }

  /** Merge into the query string without adding a history entry. */
  setQuery(updates: Record<string, string | number | null | undefined>): void {
    const params = this.query;
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined || value === "") params.delete(key);
      else params.set(key, String(value));
    }
    const search = params.toString();
    this.navigate(this.path + (search ? `?${search}` : ""), { replace: true });
  }

  sync(): void {
    this.path = location.pathname;
    this.search = location.search;
  }

  /**
   * Client-side navigation for plain clicks on same-origin /admin links, and
   * Back/Forward. Modified clicks (new tab, download) are left to the browser.
   */
  install(): () => void {
    // "/admin/" is the Vite dev server's base; production redirects it.
    if (location.pathname.length > 1 && location.pathname.endsWith("/")) {
      history.replaceState(null, "", location.pathname.replace(/\/+$/, "") + location.search);
      this.sync();
    }

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/admin")) return;
      e.preventDefault();
      this.navigate(href);
    };
    const onPop = () => this.sync();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      for (const guard of this.#guards) {
        if (guard()) {
          e.preventDefault();
          return;
        }
      }
    };
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPop);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }
}

export const router = new Router();
