/**
 * Command-palette open state, kept out of the component so anything can open
 * it — the topbar button, the keyboard shortcut, an empty-state prompt — without
 * a chain of props or a custom window event.
 */
class Palette {
  open = $state(false);
  query = $state("");

  show(): void {
    this.query = "";
    this.open = true;
  }

  hide(): void {
    this.open = false;
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }
}

export const palette = new Palette();
export const openPalette = () => palette.show();

/**
 * Ctrl/Cmd-K, installed once by the root layout.
 *
 * `e.isComposing` is the load-bearing part. Vietnamese is a shipped locale and
 * Telex/VNI input goes through an IME composition session; without this check
 * the shortcut fires mid-composition and steals the keystroke, which made the
 * palette actively hostile to exactly the users the `vi` locale exists for.
 * The React version was missing it.
 *
 * Returns a teardown function for the layout's $effect.
 */
export function installPaletteShortcut(): () => void {
  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      palette.toggle();
      return;
    }
    if (e.key === "Escape" && palette.open) palette.hide();
  }
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
