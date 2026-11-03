import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withoutBlockComments } from "./testing/source";

const gate = withoutBlockComments(
  readFileSync(join(process.cwd(), "src", "lib", "common", "ConsentGate.svelte"), "utf-8"),
);
const capability = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri", "capabilities", "default.json"), "utf-8"),
) as { permissions: string[] };

describe("declining the terms in the apps", () => {
  it("quits through the app module, not the window", () => {
    // getCurrentWindow().close() does nothing on Android, where Decline sat
    // there dead. exit() finishes the activity.
    expect(gate).toContain('import("@tauri-apps/api/app")');
    expect(gate).not.toContain('import("@tauri-apps/api/window")');
  });

  it("is allowed to quit, and to do nothing more", () => {
    // Without the permission exit() throws, and Decline only shows a notice.
    expect(capability.permissions).toContain("core:app:allow-exit");
    // Closing a window from script was Decline's alone; nothing needs it now.
    expect(capability.permissions).not.toContain("core:window:allow-close");
  });
});

describe("leaving the site from the terms", () => {
  it("offers Leave on the terms card and on the declined notice, on the web only", () => {
    expect(gate.match(/onclick=\{leave\}/g)).toHaveLength(2);
    expect(gate.match(/\{#if canLeave\}/g)).toHaveLength(2);
    expect(gate).toContain("const canLeave = !isTauri();");
  });
});
