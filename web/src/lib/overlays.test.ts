import { afterEach, describe, expect, it, vi } from "vitest";
import { focusOnMount, overlays } from "./overlays.svelte";
import { installPaletteShortcut, palette } from "./palette.svelte";

afterEach(() => {
  overlays.consent = false;
  overlays.humanCheck = false;
  palette.hide();
  vi.unstubAllGlobals();
});

describe("first-run overlays", () => {
  it("count as open while either the consent gate or the human check is", () => {
    expect(overlays.open).toBe(false);
    overlays.consent = true;
    expect(overlays.open).toBe(true);
    overlays.consent = false;
    overlays.humanCheck = true;
    expect(overlays.open).toBe(true);
    overlays.humanCheck = false;
    expect(overlays.open).toBe(false);
  });

  it("take focus as they mount, without scrolling to it", () => {
    const focus = vi.fn();
    focusOnMount({ focus } as unknown as HTMLElement);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

describe("the Ctrl/Cmd+K shortcut", () => {
  /** A keydown with only what the handler reads; this suite runs in Node. */
  function press(target: EventTarget, init: { key: string; ctrlKey?: boolean }): Event {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      isComposing: false,
      keyCode: 0,
      metaKey: false,
      ctrlKey: false,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("stands down under a first-run overlay, and toggles the palette otherwise", () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const teardown = installPaletteShortcut();
    try {
      // Under the gate the palette would open beneath it and hold focus out
      // of sight, so the key is left alone entirely.
      overlays.consent = true;
      const ignored = press(win, { key: "k", ctrlKey: true });
      expect(palette.open).toBe(false);
      expect(ignored.defaultPrevented).toBe(false);

      overlays.consent = false;
      const handled = press(win, { key: "k", ctrlKey: true });
      expect(palette.open).toBe(true);
      expect(handled.defaultPrevented).toBe(true);

      press(win, { key: "Escape" });
      expect(palette.open).toBe(false);
    } finally {
      teardown();
    }
  });
});
