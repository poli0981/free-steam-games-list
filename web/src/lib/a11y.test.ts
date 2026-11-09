/**
 * The accessibility fixes behind ACCESSIBILITY.md's "What works today", held
 * in place by reading the source, like mobile-layout.test.ts. None of this
 * replaces trying the app with a keyboard and a screen reader; it stops a
 * refactor from quietly undoing what was checked by hand.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withoutBlockComments } from "./testing/source";
import { COLS } from "./games/columns";

const raw = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf-8");
const src = (...p: string[]) => withoutBlockComments(raw(...p));
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("the games table", () => {
  const table = src("src", "lib", "games", "GamesTable.svelte");

  it("is a complete ARIA table, so its rows mean something", () => {
    // Rows used to be <a role="row"> with nothing around them: neither a
    // table nor a link to a screen reader.
    expect(table).toContain('role="table"');
    expect(table).toContain("aria-rowcount=");
    expect(table).toContain("aria-colcount=");
    expect(table).toContain('role="rowgroup"');
    expect(count(table, "aria-rowindex=")).toBe(2);
    expect(table).not.toMatch(/<a\b[^>]*\brole="row"/);
  });

  it("has one link per row, and no fake link nested in it", () => {
    expect(table).not.toContain('role="link"');
    expect(table).toContain("after:absolute after:inset-0");
  });

  it("names every column, the icon-only ones for screen readers", () => {
    for (const col of COLS) expect(col.label || col.srLabel, col.key).toBeTruthy();
  });
});

describe("the phone cards", () => {
  it("are a list that says how long it is and where each card sits", () => {
    const cards = src("src", "lib", "games", "MobileGameCards.svelte");
    for (const attr of ['role="list"', 'role="listitem"', "aria-setsize=", "aria-posinset="]) {
      expect(cards).toContain(attr);
    }
  });
});

describe("list panes at high zoom", () => {
  it.each([
    ["GamesTable.svelte", "h-[calc(100dvh-20rem)]"],
    ["MobileGameCards.svelte", "h-[calc(100dvh-18rem)]"],
  ])("%s keeps a minimum height", (file, height) => {
    // Sized to the window alone, the pane reached zero at 300-400% zoom.
    const text = src("src", "lib", "games", file);
    const classes = text.slice(text.indexOf(height) - 40, text.indexOf(height) + 80);
    expect(classes).toMatch(/\bmin-h-/);
  });
});

describe("kernel-level anti-cheat", () => {
  it("is never told apart by colour alone", () => {
    const files = [
      ["src", "lib", "games", "GamesTable.svelte"],
      ["src", "lib", "games", "MobileGameCards.svelte"],
      ["src", "routes", "games", "[appid]", "+page.svelte"],
      ["src", "routes", "random", "+page.svelte"],
    ];
    for (const f of files) {
      const text = src(...f);
      expect(text, f.join("/")).not.toMatch(/is_kernel_ac \? "destructive"/);
      expect(text, f.join("/")).toContain("<AntiCheatBadge");
    }
    const badge = src("src", "lib", "games", "AntiCheatBadge.svelte");
    expect(badge).toContain("ShieldAlert");
    expect(badge).toContain('t("charts.acLevel.kernel")');
  });
});

describe("the first-run overlays", () => {
  // Raw text: "/legal/*" in a line comment of the gate reads as the start of
  // a block comment to withoutBlockComments, which then swallows real code.
  const gate = raw("src", "lib", "common", "ConsentGate.svelte");
  const check = raw("src", "lib", "common", "HumanCheck.svelte");
  const layout = raw("src", "routes", "+layout.svelte");

  it("are modal dialogs that take focus, with one heading level below the page's", () => {
    // Three cards in the gate: the terms, the declined notice, Leave site.
    expect(count(gate, 'role="dialog"')).toBe(3);
    expect(count(gate, 'aria-modal="true"')).toBe(3);
    expect(count(gate, "{@attach focusOnMount}")).toBe(3);
    expect(check).toContain('role="dialog"');
    expect(check).toContain("{@attach focusOnMount}");
    expect(gate).not.toContain("<h1");
    expect(check).not.toContain("<h1");
  });

  it("make everything behind them inert", () => {
    expect(gate).toContain("overlays.consent = open");
    expect(check).toContain("overlays.humanCheck = open");
    // The bare pages' wrapper, the skip link and the shell.
    expect(count(layout, "inert={overlays.open || undefined}")).toBe(3);
  });

  it("are never covered by the command palette", () => {
    const palette = src("src", "lib", "palette.svelte.ts");
    expect(palette).toContain("if (overlays.open) return;");
  });
});

describe("back to top", () => {
  it("is out of reach while hidden, and honours reduced motion", () => {
    const button = src("src", "lib", "common", "BackToTop.svelte");
    expect(button).toContain("inert={!visible || undefined}");
    expect(button).toContain("prefers-reduced-motion: reduce");
  });
});

describe("the desktop app", () => {
  it("lets the reader zoom", () => {
    const conf = JSON.parse(readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf-8")) as {
      app: { windows: { label: string; zoomHotkeysEnabled?: boolean }[] };
    };
    expect(conf.app.windows.find((w) => w.label === "main")?.zoomHotkeysEnabled).toBe(true);
    // macOS and Linux zoom through a script that needs this permission.
    const zoom = JSON.parse(
      readFileSync(join(process.cwd(), "src-tauri", "capabilities", "zoom.json"), "utf-8"),
    ) as { platforms: string[]; permissions: string[] };
    expect(zoom.permissions).toContain("core:webview:allow-set-webview-zoom");
    expect(zoom.platforms).not.toContain("android");
  });
});

/* ───────────────────────────── contrast ───────────────────────────── */

type Rgb = [number, number, number];

function tokens(css: string, selector: string): Record<string, Rgb> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, Rgb> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%;/g)) {
    out[m[1]] = hslToRgb(Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100);
  }
  return out;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const tint = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
  [0, 1, 2].map((i) => alpha * fg[i] + (1 - alpha) * bg[i]) as Rgb;

describe("theme contrast (WCAG 2.2 AA)", () => {
  const css = readFileSync(join(process.cwd(), "src", "styles", "theme.css"), "utf-8");
  const themes = { light: tokens(css, ":root"), dark: tokens(css, ".dark") };

  it.each(Object.entries(themes))("%s: text is at least 4.5:1, control edges 3:1", (_, t) => {
    const low: string[] = [];
    const need = (label: string, value: number, min: number) => {
      if (value < min) low.push(`${label}: ${value.toFixed(2)} < ${min}`);
    };
    for (const surface of ["background", "card"]) {
      for (const text of ["foreground", "muted-foreground", "primary", "warning", "destructive", "success", "info"]) {
        need(`${text} on ${surface}`, ratio(t[text], t[surface]), 4.5);
      }
      need(`input edge on ${surface}`, ratio(t.input, t[surface]), 3);
      need(`focus ring on ${surface}`, ratio(t.ring, t[surface]), 3);
    }
    need("button label on primary", ratio(t["primary-foreground"], t.primary), 4.5);
    // Badges and the active nav item: the colour as text on its own tint.
    for (const tone of ["primary", "warning", "destructive", "success", "info"]) {
      need(`${tone} on its /15 tint`, ratio(t[tone], tint(t[tone], t.card, 0.15)), 4.5);
    }
    expect(low).toEqual([]);
  });
});
