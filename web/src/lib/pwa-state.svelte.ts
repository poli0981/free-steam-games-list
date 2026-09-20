/**
 * The installable web app: service-worker registration, update prompt,
 * install button and connectivity - WEB ONLY.
 *
 * Until this existed the service worker was built but never registered: no
 * page referenced registerSW.js, so only browsers that had installed the
 * React-era worker ran one at all, and nothing ever told a reader a new
 * version was waiting or offered to install the app.
 *
 * Registration waits for consent, like every other network cost the site
 * imposes. The `beforeinstallprompt` listener does not: that event fires once,
 * early, and a listener attached later simply never sees it.
 *
 * The packaged apps never register a worker (lib/pwa.ts explains why one at
 * tauri.localhost can never update); vite.config.ts stubs the virtual module
 * out of that build entirely.
 */
import { isTauri } from "./external-open";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

class PwaState {
  /** A new version is installed and waiting; reloading applies it. */
  needRefresh = $state(false);
  /** The app shell is cached: the site now opens without a network. */
  offlineReady = $state(false);
  online = $state(true);
  /** The browser offered installation and it has not been used yet. */
  canInstall = $state(false);
  installed = $state(false);
  /** Running as the installed app rather than in a browser tab. */
  standalone = $state(false);

  #installEvent: BeforeInstallPromptEvent | null = null;
  #updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
  #listening = false;
  #registered = false;

  /** Connectivity and install events. Cheap, no network; call on mount. */
  listen(): void {
    if (this.#listening || typeof window === "undefined" || isTauri()) return;
    this.#listening = true;

    this.online = navigator.onLine;
    window.addEventListener("online", () => (this.online = true));
    window.addEventListener("offline", () => (this.online = false));

    const standalone = window.matchMedia("(display-mode: standalone)");
    this.standalone = standalone.matches;
    standalone.addEventListener("change", (e) => (this.standalone = e.matches));

    window.addEventListener("beforeinstallprompt", (e) => {
      // Keep the browser's own mini-infobar from appearing; the app offers
      // installation from the topbar and Settings instead.
      //
      // Chrome logs "Banner not shown: beforeinstallpromptevent
      // .preventDefault() called. The page must call
      // beforeinstallpromptevent.prompt() to show the banner." every time it
      // fires. That is Chrome confirming the suppression worked, not a fault:
      // prompt() IS called, from install() below, when the reader presses one
      // of those buttons. Removing preventDefault() would put Chrome's banner
      // next to the app's own install affordances.
      e.preventDefault();
      this.#installEvent = e as BeforeInstallPromptEvent;
      this.canInstall = true;
    });
    window.addEventListener("appinstalled", () => {
      this.#installEvent = null;
      this.canInstall = false;
      this.installed = true;
    });
  }

  /** Register the service worker. Call once consent has been given. */
  async register(): Promise<void> {
    if (this.#registered || typeof window === "undefined" || isTauri()) return;
    if (!("serviceWorker" in navigator)) return;
    this.#registered = true;

    const { registerSW } = await import("virtual:pwa-register");
    this.#updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => (this.needRefresh = true),
      onOfflineReady: () => (this.offlineReady = true),
      onRegisteredSW: (_url, registration) => {
        // A tab left open for days should still hear about a deploy.
        if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
      },
      onRegisterError: (error) => console.warn("[pwa] service worker registration failed", error),
    });
  }

  async install(): Promise<void> {
    const event = this.#installEvent;
    if (!event) return;
    this.#installEvent = null;
    this.canInstall = false;
    await event.prompt();
    // `appinstalled` reports success; a dismissal leaves nothing to offer until
    // the browser fires beforeinstallprompt again.
    await event.userChoice.catch(() => undefined);
  }

  /** Activate the waiting worker and reload into the new version. */
  async applyUpdate(): Promise<void> {
    this.needRefresh = false;
    await this.#updateSW?.(true);
  }
}

export const pwa = new PwaState();
