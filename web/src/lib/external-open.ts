// Open an external URL. On Tauri desktop, window.open() to an external
// HTTP(S) URL is blocked by the webview, so route through the shell plugin.
// Web/PWA path keeps the legacy behaviour (no Tauri import in the web bundle
// — the plugin module is lazy-imported only when we detect the Tauri runtime).

interface TauriRuntime extends Window {
  __TAURI_INTERNALS__?: unknown;
}

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as TauriRuntime).__TAURI_INTERNALS__
  );
}

/** Running on Android (used to gate the Android-only in-app update check — the
 *  Tauri updater plugin is desktop-only). */
export function isAndroid(): boolean {
  return (
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)
  );
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch (err) {
      // Fall through to window.open as a last resort. The Tauri webview will
      // likely block it, but we surface the error so triage isn't silent.
      console.error("openExternal: shell plugin failed, falling back", err);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
