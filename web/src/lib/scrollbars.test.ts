import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCROLLBAR_MODES, scrollbarMode } from "./prefs.svelte";

/**
 * The "hide scrollbars" setting (Settings → Scrollbars) works by marking scroll
 * containers: .scrollbar-panel for tables, lists and side panels,
 * .scrollbar-page for the main content area. A container that is not marked
 * silently ignores the reader's choice, so every themed scroll container must
 * carry one of the two.
 */

const SRC = join(__dirname, "..");
const ADMIN_SRC = join(SRC, "..", "admin", "src");

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return svelteFiles(full);
    return name.endsWith(".svelte") ? [full] : [];
  });
}

describe("scrollbarMode", () => {
  it("restores the two stored modes and treats anything else as the default", () => {
    expect(scrollbarMode("panels")).toBe("panels");
    expect(scrollbarMode("all")).toBe("all");
    for (const junk of [null, undefined, "", "visible", "hidden", "ALL"]) {
      expect(scrollbarMode(junk)).toBe("visible");
    }
    expect(SCROLLBAR_MODES).toEqual(["visible", "panels", "all"]);
  });
});

describe("scroll containers", () => {
  // Tailwind 4.3 ships a core `scrollbar-thin` (plain scrollbar-width: thin).
  // In Chromium 121+ any standard scrollbar property switches the themed
  // ::-webkit-scrollbar styles off, so the bar goes back to the OS's grey.
  it("never uses Tailwind's core scrollbar-thin", () => {
    const offenders = [...svelteFiles(SRC), ...svelteFiles(ADMIN_SRC)].filter((file) =>
      /class="[^"]*(?<![\w-])scrollbar-thin(?![\w-])/.test(readFileSync(file, "utf-8")),
    );
    expect(offenders).toEqual([]);
  });

  it("every themed scroll container opts into the reader's choice", () => {
    const offenders: string[] = [];
    for (const file of svelteFiles(SRC)) {
      const text = readFileSync(file, "utf-8");
      for (const m of text.matchAll(/class="([^"]*\bscrollbar-slim\b[^"]*)"/g)) {
        if (!/\bscrollbar-(panel|page)\b/.test(m[1])) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("theme.css hides both kinds for the modes that ask for it", () => {
    const css = readFileSync(join(SRC, "styles", "theme.css"), "utf-8");
    expect(css).toContain("@utility scrollbar-slim {");
    expect(css).toContain(':root[data-scrollbars="panels"] .scrollbar-panel');
    expect(css).toContain(':root[data-scrollbars="all"] :is(.scrollbar-panel, .scrollbar-page)');
  });
});
