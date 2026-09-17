// Global click interceptor: route external-link clicks through the Tauri
// shell so they open in the system browser. The Tauri webview (desktop AND
// Android) blocks window.open() / <a target="_blank"> to external HTTP(S),
// so without this every plain external <a> across the app (About, Sidebar,
// the game page, the legal documents, …) would dead-click. One capture-phase
// listener handles them all instead of editing each anchor.
//
// No-op outside Tauri — the web build keeps native anchor behaviour.

import { isTauri, openExternal } from "./external-open";

/** Install once at boot. Safe to call on web (returns immediately). */
export function installExternalLinkInterceptor(): void {
  if (!isTauri()) return;

  document.addEventListener(
    "click",
    (e) => {
      // Let modified / non-primary clicks and already-handled events through.
      if (e.defaultPrevented || e.button !== 0) return;

      const target = e.target as Element | null;
      const anchor = target?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;

      // In-page anchors and root-relative app paths stay in the webview.
      if (href.startsWith("#") || href.startsWith("/")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }

      const isHttp = url.protocol === "http:" || url.protocol === "https:";
      const external =
        // Cross-origin web link (github.com, steam store, the game's site…)
        (isHttp && url.origin !== window.location.origin) ||
        // Non-web external scheme (steam://, mailto:, tg:) — but not in-page
        // blob:/data: resources.
        (!isHttp && url.protocol !== "blob:" && url.protocol !== "data:");
      if (!external) return;

      e.preventDefault();
      void openExternal(url.href);
    },
    true,
  );
}
