/**
 * The desktop app's own update check.
 *
 * The updater plugin, its signing key and its capability were all configured
 * for 2.0.0, and nothing ever called check() - and its endpoint pointed at a
 * GitHub "latest" release that is usually the dataset, not the desktop app, so
 * it could not have found anything anyway. The feed is now
 * free-steam-games.win/api/updates/desktop (worker/routes/updates.ts).
 *
 * Desktop only. The plugin is not compiled for Android, which checks for a
 * newer APK itself (lib/android-update.ts). Both plugin modules are imported
 * dynamically so the web bundle never carries them.
 */
import { isAndroid, isTauri } from "./external-open";

export interface DesktopUpdate {
  version: string;
  currentVersion: string;
  date?: string;
  /** Release notes, rendered as plain text only. */
  body?: string;
  /** Download, verify against the bundled public key, install, relaunch. */
  install(onProgress: (downloaded: number, total: number | null) => void): Promise<void>;
}

let checked = false;

/** Once per session. Resolves null when there is nothing to offer. */
export async function checkDesktopUpdate(): Promise<DesktopUpdate | null> {
  if (checked || !isTauri() || isAndroid()) return null;
  checked = true;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      date: update.date,
      body: update.body,
      async install(onProgress) {
        let total: number | null = null;
        let downloaded = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") total = event.data.contentLength ?? null;
          else if (event.event === "Progress") downloaded += event.data.chunkLength;
          onProgress(downloaded, total);
        });
        // On Windows the installer usually exits the app on its own before
        // this line runs; everywhere else the app restarts into the update.
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (err) {
    // Offline, feed unavailable, or a signature that did not verify. None of
    // those should interrupt the reader; the next launch tries again.
    console.warn("[desktop-update] check failed", err);
    return null;
  }
}
