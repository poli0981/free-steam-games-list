/**
 * The web app's Turnstile human check: every decision it makes, kept free of
 * Svelte and the DOM so each one is tested directly (human-check.test.ts).
 *
 *   - human-check-state.svelte.ts holds the state (passed, when it expires),
 *   - common/HumanCheck.svelte is the overlay that renders the widget,
 *   - worker/routes/human-check.ts verifies the token with the secret.
 *
 * WEB ONLY, AFTER CONSENT, AND SOFT BY DESIGN. It is an overlay, like the
 * consent gate: the prerendered pages are served without the Worker, and
 * docs/ToS.md section 9 promises that /api/data/*, /img/* and the packaged
 * apps are never human-checked. It keeps automated browsers from using the
 * app; it cannot stop anything that reads the HTML or the API directly, and it
 * is not meant to - the WAF rules in docs/SECURITY_SETUP.md are the boundary.
 *
 * It refuses only on a verdict - Cloudflare said no. Anything that is this
 * site's fault (no secret, siteverify down, a widget misconfiguration) or that
 * leaves nothing to protect (offline) lets the reader through for that page
 * load, unrecorded, so the check runs again on the next one.
 */
import { SITE_ORIGIN } from "./site";
import { HUMAN_CHECK_TTL_SECONDS, type HumanCheckReply } from "../../shared/human-check";

/**
 * The Turnstile widget's site key. NOT a secret: every page that renders the
 * widget publishes it, and it only names which widget this is. From the
 * Cloudflare dashboard, Turnstile, the widget's settings.
 *
 * Empty disables the check entirely, which is what a fork wants.
 */
export const TURNSTILE_SITEKEY = "0x4AAAAAAFBCR0VoAM7zOoyg";

/** Cloudflare's published always-pass test key: any hostname, no challenge. */
const TEST_SITEKEY = "1x00000000000000000000AA";

/** localStorage: `{ until }`, epoch milliseconds. */
export const HUMAN_CHECK_KEY = "f2p:human_check";

const MIN_TTL_SECONDS = 60;
/** Also the most a stored pass may claim: a later `until` is a wrong clock or a hand edit. */
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface PassRecord {
  until: number;
}

/**
 * Whether the check runs at all. Never in the packaged apps (Turnstile does
 * not even work under tauri://), never under `npm run dev` (its /api proxy
 * points at production, which refuses a localhost token), and not in a fork
 * that has no widget of its own.
 */
export function humanCheckEnabled(env: { tauri: boolean; dev: boolean; sitekey: string }): boolean {
  return !env.tauri && !env.dev && env.sitekey !== "";
}

/**
 * The real key on the production hostname only. The widget refuses every
 * hostname its dashboard entry does not list, so everywhere else - localhost
 * under `wrangler dev`, a LAN address from a phone - gets the always-pass test
 * key, which pairs with the test secret in web/.dev.vars.
 */
export function siteKeyFor(hostname: string, sitekey = TURNSTILE_SITEKEY): string {
  return hostname === new URL(SITE_ORIGIN).hostname ? sitekey : TEST_SITEKEY;
}

/** A stored pass that has not expired and does not claim an impossible future. */
export function isPassValid(stored: unknown, now: number): boolean {
  if (typeof stored !== "object" || stored === null) return false;
  const until = (stored as { until?: unknown }).until;
  return (
    typeof until === "number" &&
    Number.isFinite(until) &&
    until > now &&
    until - now <= MAX_TTL_SECONDS * 1000
  );
}

/** The pass to store for a Worker-supplied TTL, clamped to something sane. */
export function passRecord(ttl: unknown, now: number): PassRecord {
  const seconds =
    typeof ttl === "number" && Number.isFinite(ttl)
      ? Math.min(Math.max(ttl, MIN_TTL_SECONDS), MAX_TTL_SECONDS)
      : HUMAN_CHECK_TTL_SECONDS;
  return { until: now + seconds * 1000 };
}

/**
 * What the Worker's answer means for the reader.
 *
 *   pass     - verified; store it for the TTL.
 *   refused  - Cloudflare said no (the route's 403 "rejected"); offer Retry.
 *   waive    - the site could not decide (no secret, siteverify down, any
 *              other status): let this page load through, store nothing.
 */
export type ReplyOutcome = "pass" | "refused" | "waive";

export function replyOutcome(status: number, reply: HumanCheckReply | null): ReplyOutcome {
  if (status >= 200 && status < 300 && reply?.ok === true) return "pass";
  if (status === 403 && reply?.error === "rejected") return "refused";
  return "waive";
}

/**
 * What a widget error code means, by Cloudflare's own taxonomy
 * (developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/).
 *
 *   config     - this site's setup is wrong (bad parameters, sitekey unknown
 *                or disabled, hostname not allowed - which is also what a
 *                page viewed through a translation proxy gets): waive.
 *   challenge  - 300xxx/600xxx, the challenge was not passed: refuse.
 *   transient  - timeouts, a frame that did not load, anything else: Retry.
 */
export type WidgetFault = "config" | "challenge" | "transient";

const CONFIG_ERRORS = /^(10[2-6]\d{3}|110100|110110|110200|400020|400070)$/;
const CHALLENGE_ERRORS = /^[36]\d{5}$/;

export function widgetFault(code: string): WidgetFault {
  if (CONFIG_ERRORS.test(code)) return "config";
  if (CHALLENGE_ERRORS.test(code)) return "challenge";
  return "transient";
}
