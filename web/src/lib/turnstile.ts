/**
 * Cloudflare Turnstile's api.js, loaded on demand - WEB ONLY, and only by the
 * human check (common/HumanCheck.svelte), which runs after consent.
 *
 * Appended at runtime, like lib/analytics.ts's beacon and for the same reason:
 * kit.csp runs in mode "hash", which admits an external script by host
 * (`script-src https://challenges.cloudflare.com`, web flavour only) and never
 * an inline one. The widget itself is an iframe from that host, which is what
 * the web policy's `frame-src` is for. The Tauri policy has neither.
 *
 * Always Cloudflare's exact URL, never a proxied or cached copy: Cloudflare
 * documents that a copy stops working when they update the script.
 *
 * The types cover only what HumanCheck.svelte uses; there is no @types
 * package, and window is reached through a cast (the TauriRuntime pattern in
 * external-open.ts) rather than a global declaration.
 */

const API_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: "auto" | "light" | "dark";
  language?: string;
  size?: "normal" | "flexible" | "compact";
  appearance?: "always" | "execute" | "interaction-only";
  /** No form here, so no hidden cf-turnstile-response input either. */
  "response-field"?: boolean;
  callback?: (token: string) => void;
  /** Return true to mark the error handled; Turnstile throws otherwise. */
  "error-callback"?: (code: string) => boolean;
  "unsupported-callback"?: () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

interface TurnstileWindow extends Window {
  turnstile?: TurnstileApi;
}

/** The one <script> element, kept across a timeout so a retry waits for it
 *  instead of adding a second copy of api.js. Dropped when it fails to load. */
let script: HTMLScriptElement | null = null;

export function loadTurnstile(timeoutMs = 20_000): Promise<TurnstileApi> {
  const w = window as TurnstileWindow;
  if (w.turnstile) return Promise.resolve(w.turnstile);

  if (!script) {
    const el = document.createElement("script");
    el.src = API_SRC;
    el.async = true;
    // Registered first, so it runs before any waiter's handler: a failed
    // element is gone by the time anyone retries, and the retry appends anew.
    el.addEventListener(
      "error",
      () => {
        el.remove();
        if (script === el) script = null;
      },
      { once: true },
    );
    document.head.appendChild(el);
    script = el;
  }

  const el = script;
  return new Promise<TurnstileApi>((resolve, reject) => {
    const settle = () => {
      clearTimeout(timer);
      el.removeEventListener("load", onLoad);
      el.removeEventListener("error", onError);
    };
    const onLoad = () => {
      settle();
      if (w.turnstile) resolve(w.turnstile);
      else reject(new Error("turnstile: api.js loaded without defining window.turnstile"));
    };
    const onError = () => {
      settle();
      reject(new Error("turnstile: api.js failed to load"));
    };
    const timer = setTimeout(() => {
      settle();
      reject(new Error("turnstile: api.js timed out"));
    }, timeoutMs);
    el.addEventListener("load", onLoad);
    el.addEventListener("error", onError);
  });
}
