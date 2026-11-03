/**
 * "Leave site" on the first-run terms screen.
 *
 * A page cannot open the browser's own start page: chrome://newtab, about:home
 * and edge://newtab are all refused to websites. The closest thing is the page
 * this tab showed before the site - the new-tab page when the address was typed
 * there, the search results when the reader came from a search - so that is
 * where this goes.
 *
 * The Navigation API (Baseline since 2026-01) knows this site's run of entries
 * in the tab: entries() is the contiguous same-origin stretch around the
 * current entry, other documents of this origin and SvelteKit's own pushState
 * entries included, and currentEntry.index is the position in it. So
 * history.go(-(index + 1)) lands on the entry just before the site, in one
 * step, however many of the site's own pages (a legal document, say) came in
 * between. Without the API it is one step back, which may land on one of the
 * site's pages; the reader clicks again.
 *
 * history.go() says nothing when there is nowhere to go - the foreign entries
 * may all be FORWARD ones (the reader went on to another site and came back) -
 * so a watchdog calls onNowhere if the page is still here LEAVE_TIMEOUT_MS
 * later. beforeunload (a traversal leaving the document has started), pagehide
 * (the page is going, into the back/forward cache too) and popstate (a landing
 * inside the document, the legacy path) cancel it. Timers freeze in the
 * back/forward cache and resume on restore, so pagehide clears it whether or
 * not the page is kept: a page brought back by Forward must not then claim it
 * had nowhere to go.
 *
 * When every entry is the site's (the tab, or the installed app's window, was
 * opened on it) there is nothing to go back to, and onNowhere runs at once.
 * Closing is then a separate, deliberate click (closeTab): closing the last tab
 * closes the window, and the browser with it, which "leave this site" never
 * asked for.
 */
export const LEAVE_TIMEOUT_MS = 1500;

type LeaveEvent = "beforeunload" | "pagehide" | "popstate";
const SETTLED: readonly LeaveEvent[] = ["beforeunload", "pagehide", "popstate"];

/** The parts of `window` this needs; the real window satisfies it as it is. */
export interface LeaveWindow {
  readonly history: { readonly length: number; go(delta: number): void };
  readonly navigation?: {
    readonly currentEntry: { readonly index: number } | null;
    entries(): readonly unknown[];
  };
  readonly closed: boolean;
  close(): void;
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(id: number): void;
  addEventListener(type: LeaveEvent, listener: () => void): void;
  removeEventListener(type: LeaveEvent, listener: () => void): void;
}

export type LeaveStart = "traversing" | "nowhere";

// A second click while the first traversal is starting must neither arm a
// second watchdog nor step back twice.
const watching = new WeakSet<LeaveWindow>();

/** Back to the page before this site. `onNowhere` runs now when there is none,
 *  or later when the traversal never started. */
export function leaveSite(win: LeaveWindow, onNowhere: () => void): LeaveStart {
  if (watching.has(win)) return "traversing";

  const nav = win.navigation;
  const current = nav?.currentEntry;
  let delta = -1;
  if (nav && current) {
    if (win.history.length <= nav.entries().length) {
      onNowhere();
      return "nowhere";
    }
    delta = -(current.index + 1);
  } else if (win.history.length <= 1) {
    onNowhere();
    return "nowhere";
  }

  let timer = 0;
  const settle = () => {
    win.clearTimeout(timer);
    for (const type of SETTLED) win.removeEventListener(type, settle);
    watching.delete(win);
  };
  watching.add(win);
  for (const type of SETTLED) win.addEventListener(type, settle);
  timer = win.setTimeout(() => {
    settle();
    onNowhere();
  }, LEAVE_TIMEOUT_MS);
  win.history.go(delta);
  return "traversing";
}

/** Close the tab; true when the browser agreed. A script may close only a tab
 *  whose history holds this one page (or one a script opened), and `closed`
 *  turns true at once when the browser accepts. */
export function closeTab(win: Pick<LeaveWindow, "close" | "closed">): boolean {
  win.close();
  return win.closed;
}
