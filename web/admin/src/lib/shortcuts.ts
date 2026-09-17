/**
 * Keyboard shortcuts for the queue, and the one rule every shortcut obeys:
 * a keystroke that belongs to something else is never taken.
 */

export interface Shortcut {
  key: string;
  label: string;
}

export const QUEUE_SHORTCUTS: Shortcut[] = [
  { key: "j", label: "Next row" },
  { key: "k", label: "Previous row" },
  { key: "x", label: "Select or deselect the row" },
  { key: "a", label: "Approve the selection" },
  { key: "r", label: "Reject the selection" },
  { key: "d", label: "Defer, or send back to pending" },
  { key: "e", label: "Open the row's details" },
  { key: "/", label: "Search" },
  { key: "Escape", label: "Clear the selection" },
  { key: "?", label: "Show these shortcuts" },
];

/** Inputs that take no typing, so a letter key pressed on one is a shortcut. */
const KEYLESS_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/**
 * True when the key must be left alone: typing in a field, IME composition
 * (Vietnamese Telex/VNI input), a modified key, or an open dialog.
 *
 * A focused checkbox is NOT a field. Ticking a row leaves focus on its
 * checkbox, and treating that as typing made "a" do nothing straight after
 * selecting - the one moment it is wanted.
 */
export function shouldIgnore(e: Pick<KeyboardEvent, "isComposing" | "keyCode" | "ctrlKey" | "metaKey" | "altKey" | "target">): boolean {
  if (e.isComposing || e.keyCode === 229) return true;
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const target = e.target as Element | null;
  const field =
    target && typeof target.closest === "function"
      ? target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")
      : null;
  if (field) {
    if (field.tagName !== "INPUT") return true;
    if (!KEYLESS_INPUTS.has((field.getAttribute("type") ?? "text").toLowerCase())) return true;
  }
  if (typeof document !== "undefined" && document.querySelector("dialog[open]")) return true;
  return false;
}
