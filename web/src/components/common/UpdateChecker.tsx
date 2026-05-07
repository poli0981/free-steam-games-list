import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, RotateCw, X } from "lucide-react";
import { Button } from "../ui/button";

/**
 * Tauri-only auto-update checker. In the web/PWA build this component is
 * effectively a no-op because the Tauri plugin imports throw outside the
 * Tauri runtime. We do a runtime detection (`window.__TAURI_INTERNALS__`)
 * and lazy-load the updater module so the browser bundle pays nothing
 * extra for desktop-only behaviour.
 *
 * Flow on desktop:
 *   1. On mount → ask the updater if a release is newer than the current
 *      bundled version.
 *   2. If yes → toast with "Download" / "Later" buttons + the new version.
 *   3. On Download → stream the .tar.gz / .zip / .AppImage update,
 *      verifying the minisign signature against the pubkey baked into
 *      tauri.conf.json. Show progress in a separate toast.
 *   4. When done → "Restart now" toast → calls relaunch().
 *
 * On error (no network, signature mismatch, server down) we silently
 * fall back to "no update". The web app continues to work either way.
 */

interface TauriRuntime {
  __TAURI_INTERNALS__?: unknown;
}

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as TauriRuntime).__TAURI_INTERNALS__
  );
}

export function UpdateChecker() {
  const [, setSeenVersion] = useState<string | null>(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!isTauri() || checkedRef.current) return;
    checkedRef.current = true;
    void runCheck(setSeenVersion);
  }, []);

  return null;
}

async function runCheck(setSeen: (v: string | null) => void) {
  try {
    const updater = await import("@tauri-apps/plugin-updater");
    const update = await updater.check();
    if (!update) {
      setSeen(null);
      return;
    }

    setSeen(update.version);

    toast.message(`Update available: ${update.version}`, {
      id: "tauri-update",
      duration: Infinity,
      description: update.body
        ? update.body.split("\n")[0].slice(0, 120)
        : `Current ${update.currentVersion} → ${update.version}`,
      icon: <Download className="h-4 w-4 text-primary" />,
      action: {
        label: "Download",
        onClick: () => void downloadAndInstall(update),
      },
      cancel: {
        label: "Later",
        onClick: () => toast.dismiss("tauri-update"),
      },
    });
  } catch (err) {
    // Network down, server 404, signature mismatch, … all silent.
    console.warn("[updater] check failed:", err);
  }
}

interface UpdateHandle {
  version: string;
  currentVersion: string;
  body?: string | null;
  downloadAndInstall: (
    onEvent?: (event: {
      event: string;
      data?: { contentLength?: number; chunkLength?: number };
    }) => void,
  ) => Promise<void>;
}

async function downloadAndInstall(update: UpdateHandle) {
  let downloaded = 0;
  let total = 0;

  toast.loading(`Downloading ${update.version}…`, {
    id: "tauri-update",
    description: "0%",
    duration: Infinity,
  });

  try {
    await update.downloadAndInstall((evt) => {
      switch (evt.event) {
        case "Started":
          total = evt.data?.contentLength ?? 0;
          break;
        case "Progress":
          downloaded += evt.data?.chunkLength ?? 0;
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            toast.loading(`Downloading ${update.version}…`, {
              id: "tauri-update",
              description: `${pct}% · ${(downloaded / 1_000_000).toFixed(1)} / ${(total / 1_000_000).toFixed(1)} MB`,
              duration: Infinity,
            });
          }
          break;
        case "Finished":
          break;
      }
    });

    toast.success("Update ready", {
      id: "tauri-update",
      description: "Restart to apply.",
      duration: Infinity,
      icon: <RotateCw className="h-4 w-4 text-emerald-400" />,
      action: {
        label: "Restart now",
        onClick: async () => {
          try {
            const { relaunch } = await import("@tauri-apps/plugin-process");
            await relaunch();
          } catch (err) {
            console.warn("[updater] relaunch failed:", err);
          }
        },
      },
      cancel: {
        label: <X className="h-3 w-3" />,
        onClick: () => toast.dismiss("tauri-update"),
      },
    });
  } catch (err) {
    toast.error("Update failed", {
      id: "tauri-update",
      description: err instanceof Error ? err.message : String(err),
    });
    void Button; // keep import for tree-shake
  }
}
