/**
 * The web app's Turnstile human check, as both halves see it: the overlay that
 * renders the widget (src/lib/common/HumanCheck.svelte) and the Worker route
 * that verifies its token (worker/routes/human-check.ts).
 *
 * One definition, because the widget is rendered with an `action` that
 * siteverify echoes back and the Worker insists on. If the two ever named
 * different actions, every real visitor would fail the check.
 */

/**
 * Same-origin only. The web build calls it with a relative URL, and the route
 * sends no CORS header - the packaged apps never run the check, so nothing
 * cross-origin has a reason to reach it.
 */
export const HUMAN_CHECK_PATH = "/api/human-check";

/** Turnstile allows up to 32 characters of [A-Za-z0-9_-]. */
export const HUMAN_CHECK_ACTION = "enter";

/** How long a pass lasts in the browser before the check runs again. */
export const HUMAN_CHECK_TTL_SECONDS = 24 * 60 * 60;

/**
 * What the route answers. `ttl` comes with a pass; `codes` with a refusal, and
 * they are Cloudflare's own error strings (`invalid-input-response`,
 * `timeout-or-duplicate`, ...), never anything the visitor sent.
 */
export interface HumanCheckReply {
  ok?: boolean;
  ttl?: number;
  error?: string;
  codes?: string[];
}
