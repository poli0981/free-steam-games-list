import { describe, expect, it } from "vitest";
import { shouldIgnore } from "./shortcuts";

/** A stand-in for event.target: closest() answers for one matched element. */
function target(tagName: string | null, type?: string) {
  const el = tagName ? { tagName, getAttribute: (n: string) => (n === "type" ? (type ?? null) : null) } : null;
  return { closest: () => el } as unknown as EventTarget;
}

function key(overrides: Partial<Pick<KeyboardEvent, "isComposing" | "keyCode" | "ctrlKey" | "metaKey" | "altKey" | "target">> = {}) {
  return { isComposing: false, keyCode: 65, ctrlKey: false, metaKey: false, altKey: false, target: target(null), ...overrides };
}

describe("shouldIgnore", () => {
  it("takes a plain key on the page", () => {
    expect(shouldIgnore(key())).toBe(false);
  });

  it("leaves typing in a text field alone", () => {
    expect(shouldIgnore(key({ target: target("INPUT", "text") }))).toBe(true);
    expect(shouldIgnore(key({ target: target("INPUT", "search") }))).toBe(true);
    expect(shouldIgnore(key({ target: target("INPUT") }))).toBe(true);
    expect(shouldIgnore(key({ target: target("TEXTAREA") }))).toBe(true);
    expect(shouldIgnore(key({ target: target("SELECT") }))).toBe(true);
  });

  it("does not treat a focused checkbox as typing", () => {
    // Ticking a row leaves focus on its checkbox; "a" must still approve.
    expect(shouldIgnore(key({ target: target("INPUT", "checkbox") }))).toBe(false);
    expect(shouldIgnore(key({ target: target("INPUT", "radio") }))).toBe(false);
  });

  it("never interrupts IME composition", () => {
    // Vietnamese Telex/VNI input composes with plain letter keys.
    expect(shouldIgnore(key({ isComposing: true }))).toBe(true);
    expect(shouldIgnore(key({ keyCode: 229 }))).toBe(true);
  });

  it("leaves modified keys to the browser", () => {
    expect(shouldIgnore(key({ ctrlKey: true }))).toBe(true);
    expect(shouldIgnore(key({ metaKey: true }))).toBe(true);
    expect(shouldIgnore(key({ altKey: true }))).toBe(true);
  });
});
