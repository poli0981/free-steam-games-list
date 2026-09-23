/**
 * The human check's state: whether this browser holds a pass, and whether the
 * check applies here at all. The rules are in human-check.ts; the overlay that
 * uses this is common/HumanCheck.svelte.
 *
 * Kept out of prefs.svelte.ts, which the admin SPA also compiles - the same
 * reason consent.svelte.ts is separate.
 */
import { isTauri } from "./external-open";
import { readJson, writeJson } from "./prefs.svelte";
import {
  HUMAN_CHECK_KEY,
  TURNSTILE_SITEKEY,
  humanCheckEnabled,
  isPassValid,
  passRecord,
  type PassRecord,
} from "./human-check";

class HumanCheck {
  /**
   * False until storage has been read. The overlay opens only after this,
   * like the consent gate: rendered earlier it would be baked into every
   * prerendered page and flash for every returning visitor.
   */
  hydrated = $state(false);
  enabled = $state(false);
  passed = $state(false);
  /** Let through for this page load only; never stored. See waive(). */
  #waived = $state(false);
  /**
   * The pass in memory as well as in storage. With storage refused (private
   * modes, lockdown settings) a refresh() would otherwise forget a pass won a
   * moment ago and reopen the gate on the next tab switch.
   */
  #memory: PassRecord | null = null;
  #listening = false;

  /**
   * Nothing stands between the reader and the app. The catalogue download,
   * the service worker and the analytics beacon wait for this AND consent.
   */
  get cleared(): boolean {
    return this.hydrated && (!this.enabled || this.passed || this.#waived);
  }

  /** Read from storage. Called once the app is mounted, never during prerender. */
  hydrate(): void {
    this.enabled = humanCheckEnabled({
      tauri: isTauri(),
      dev: import.meta.env.DEV,
      sitekey: TURNSTILE_SITEKEY,
    });
    // An installed web app opened with no network: Turnstile cannot load, and
    // there is nothing on the server to protect. The next online load checks.
    if (this.enabled && !navigator.onLine) this.#waived = true;
    this.refresh();

    if (this.enabled && !this.#listening) {
      this.#listening = true;
      // A tab left open past the pass asks again when the reader comes back to
      // it rather than in the middle of reading, and a pass won in another tab
      // is picked up the same way.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.refresh();
      });
      window.addEventListener("storage", (e) => {
        if (e.key === HUMAN_CHECK_KEY) this.refresh();
      });
    }
    this.hydrated = true;
  }

  refresh(): void {
    const now = Date.now();
    this.passed =
      this.enabled && (isPassValid(readJson(HUMAN_CHECK_KEY), now) || isPassValid(this.#memory, now));
  }

  /** The Worker verified the token; `ttl` is its answer, clamped. */
  markPassed(ttl: unknown): void {
    this.#memory = passRecord(ttl, Date.now());
    writeJson(HUMAN_CHECK_KEY, this.#memory);
    this.passed = true;
  }

  /**
   * Let this page load through without a pass: the check could not run for a
   * reason that is the site's, not the reader's (see human-check.ts), or the
   * reader is offline. Nothing is stored, so the next page load asks again.
   */
  waive(): void {
    this.#waived = true;
  }
}

export const humanCheck = new HumanCheck();
