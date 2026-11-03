import { describe, expect, it, vi } from "vitest";
import { LEAVE_TIMEOUT_MS, closeTab, leaveSite, type LeaveWindow } from "./leave-site";

interface FakeOptions {
  /** history.length: every entry in the tab. */
  length: number;
  /** navigation.entries().length; leave out for a browser without the API. */
  ours?: number;
  /** navigation.currentEntry.index, null for no current entry. */
  index?: number | null;
  /** Whether close() is accepted. */
  closes?: boolean;
}

/** A window whose history, timers and events the test drives by hand. */
function fakeWindow({ length, ours, index, closes = false }: FakeOptions) {
  const listeners = new Map<string, Set<() => void>>();
  const timers = new Map<number, { handler: () => void; timeout: number }>();
  let nextId = 1;
  const go = vi.fn<(delta: number) => void>();
  const win = {
    history: { length, go },
    navigation:
      ours === undefined
        ? undefined
        : {
            currentEntry: index === null ? null : { index: index ?? ours - 1 },
            entries: () => new Array<unknown>(ours),
          },
    closed: false as boolean,
    close() {
      if (closes) win.closed = true;
    },
    setTimeout(handler: () => void, timeout: number) {
      const id = nextId++;
      timers.set(id, { handler, timeout });
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  } satisfies LeaveWindow;
  return {
    win,
    go,
    fire(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    runTimers() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.handler();
      }
    },
    timeouts: () => [...timers.values()].map((t) => t.timeout),
    listening: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

describe("leaving the site", () => {
  it("steps back past every page of the site, to the one before it", () => {
    // New-tab page, then three entries of ours (a legal document among them).
    const tab = fakeWindow({ length: 4, ours: 3, index: 2 });
    const nowhere = vi.fn();
    expect(leaveSite(tab.win, nowhere)).toBe("traversing");
    expect(tab.go).toHaveBeenCalledExactlyOnceWith(-3);
    expect(tab.timeouts()).toEqual([LEAVE_TIMEOUT_MS]);
    expect(nowhere).not.toHaveBeenCalled();
  });

  it("says at once when every entry in the tab is the site's", () => {
    const tab = fakeWindow({ length: 2, ours: 2 });
    const nowhere = vi.fn();
    expect(leaveSite(tab.win, nowhere)).toBe("nowhere");
    expect(nowhere).toHaveBeenCalledOnce();
    expect(tab.go).not.toHaveBeenCalled();
    expect(tab.timeouts()).toEqual([]);
  });

  it("says so later when the only other entries are forward ones", () => {
    // The reader went on to another site and came Back: go(-1) is out of
    // range, and the browser answers that with silence.
    const tab = fakeWindow({ length: 2, ours: 1, index: 0 });
    const nowhere = vi.fn();
    leaveSite(tab.win, nowhere);
    expect(tab.go).toHaveBeenCalledWith(-1);
    expect(nowhere).not.toHaveBeenCalled();
    tab.runTimers();
    expect(nowhere).toHaveBeenCalledOnce();
    expect(tab.listening()).toBe(0);
  });

  it.each(["beforeunload", "pagehide", "popstate"])("stands the watchdog down on %s", (event) => {
    const tab = fakeWindow({ length: 3, ours: 1, index: 0 });
    const nowhere = vi.fn();
    leaveSite(tab.win, nowhere);
    tab.fire(event);
    expect(tab.timeouts()).toEqual([]);
    expect(tab.listening()).toBe(0);
    tab.runTimers();
    expect(nowhere).not.toHaveBeenCalled();
  });

  it("ignores a second click while the first is under way", () => {
    const tab = fakeWindow({ length: 3, ours: 1, index: 0 });
    leaveSite(tab.win, vi.fn());
    expect(leaveSite(tab.win, vi.fn())).toBe("traversing");
    expect(tab.go).toHaveBeenCalledOnce();
    // Brought back from the back/forward cache: a new click works again.
    tab.fire("pagehide");
    leaveSite(tab.win, vi.fn());
    expect(tab.go).toHaveBeenCalledTimes(2);
  });

  it("takes one step back without the Navigation API", () => {
    const tab = fakeWindow({ length: 3 });
    leaveSite(tab.win, vi.fn());
    expect(tab.go).toHaveBeenCalledWith(-1);

    const fresh = fakeWindow({ length: 1 });
    const nowhere = vi.fn();
    expect(leaveSite(fresh.win, nowhere)).toBe("nowhere");
    expect(nowhere).toHaveBeenCalledOnce();
    expect(fresh.go).not.toHaveBeenCalled();
  });

  it("takes one step back when the API has no current entry", () => {
    const tab = fakeWindow({ length: 3, ours: 2, index: null });
    leaveSite(tab.win, vi.fn());
    expect(tab.go).toHaveBeenCalledWith(-1);
  });
});

describe("closing the tab", () => {
  it("reports whether the browser agreed", () => {
    expect(closeTab(fakeWindow({ length: 1, closes: true }).win)).toBe(true);
    expect(closeTab(fakeWindow({ length: 2 }).win)).toBe(false);
  });
});
