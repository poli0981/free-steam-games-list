/**
 * Whether a first-run overlay (the consent gate, the human check) is on screen.
 *
 * Each overlay reports itself from an $effect, so the condition stays in the
 * component that decides to show itself. The root layout makes the page
 * underneath `inert` while one is open: out of the Tab order and out of the
 * accessibility tree, so keyboard focus and a screen reader stay in the
 * overlay. Before this, Tab walked through the whole hidden page before it
 * reached the gate's buttons. The Ctrl/Cmd+K shortcut stands down too: the
 * palette would open UNDER the gate (z-50 against z-[60]) and trap focus where
 * nobody can see it.
 *
 * Never true during prerender: both overlays wait until storage has been read.
 */
class Overlays {
  consent = $state(false);
  humanCheck = $state(false);

  get open(): boolean {
    return this.consent || this.humanCheck;
  }
}

export const overlays = new Overlays();

/**
 * Attachment for an overlay's dialog element: focus it as it mounts, so the
 * keyboard and a screen reader start inside it, on its label. The element
 * carries tabindex="-1" (focusable from script, not a Tab stop of its own).
 */
export function focusOnMount(node: HTMLElement): void {
  node.focus({ preventScroll: true });
}
