/**
 * POST /api/human-check - verify the web app's Cloudflare Turnstile token.
 *
 * The website asks each browser to pass Turnstile once a day, after the terms
 * are accepted (src/lib/common/HumanCheck.svelte). A widget token proves
 * nothing until siteverify confirms it, and the secret that call needs cannot
 * live in the page - so the page posts the token here and gets a yes or no.
 *
 * THAT ANSWER IS ALL THIS PRODUCES. No cookie, no session, nothing stored. The
 * pages are prerendered and served without invoking the Worker, and
 * docs/ToS.md section 9 promises that /api/data/*, /img/* and the packaged apps
 * are never human-checked, so there is nothing a server-side pass could unlock.
 * The check is a door for people using the web app; the WAF rules in
 * docs/SECURITY_SETUP.md stay the boundary for everything else. Do not start
 * requiring a pass on the data or image routes - that breaks the promise.
 *
 * Same-origin only, and no CORS: the packaged apps never run the check. Beyond
 * refusing another site's browser there is no CSRF defence to add - a forged
 * request can learn only whether a token it already holds is valid, and a
 * token is minted on this site's hostname and spent by the first siteverify.
 *
 * Failure statuses are chosen for the page, which lets people through on
 * anything that is this site's fault rather than theirs:
 *   403  Cloudflare said no (or the action/hostname are wrong) - a verdict.
 *   503  TURNSTILE_SECRET is not set, so deploying this before
 *        `wrangler secret put TURNSTILE_SECRET` locks nobody out; or a test
 *        widget's token met the real secret (see TEST_TOKEN).
 *   502  siteverify was unreachable, slow or garbled.
 */
import {
  HUMAN_CHECK_ACTION,
  HUMAN_CHECK_TTL_SECONDS,
  type HumanCheckReply,
} from "../../shared/human-check";
import { jsonError, SECURITY_HEADERS } from "../lib/http";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** A token is at most 2,048 characters; the JSON around it adds a dozen. */
const MAX_BODY_BYTES = 4 * 1024;
const MAX_TOKEN_LENGTH = 2048;
const SITEVERIFY_TIMEOUT_MS = 8_000;

/**
 * Cloudflare's published TEST secrets: always passes, always fails, and
 * "already spent". Their siteverify answers carry a fixed `hostname:
 * "localhost"` and `action: "test"` whatever the widget sent, so the two checks
 * below cannot apply to them. Only `web/.dev.vars` ever holds one of these.
 */
const TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

/**
 * What every TEST site key hands out. The page uses a test key on any hostname
 * but production (src/lib/human-check.ts, siteKeyFor), so this token reaching
 * a REAL secret means the site is being served somewhere the widget was never
 * set up for - a configuration fault, answered 503 so the page lets people
 * through rather than refusing everyone.
 */
const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** What siteverify returns, as far as this route reads it. */
interface Siteverify {
  success?: unknown;
  "error-codes"?: unknown;
  hostname?: unknown;
  action?: unknown;
}

function json(body: HumanCheckReply, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

/**
 * The body as text, or null past `max` bytes. Read from the stream rather than
 * with request.text(): a chunked body carries no Content-Length, and this is a
 * public endpoint, so the cap has to hold for what actually arrives.
 */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Cloudflare's error strings only, and only a few: they go back to the page. */
function errorCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string" && /^[a-z0-9-]{1,40}$/.test(c)).slice(0, 5);
}

export async function handleHumanCheck(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonError(405, "method not allowed");

  // Browsers send Origin on every POST, same-origin included, so a missing one
  // is a script - which has no business here either.
  const site = request.headers.get("Sec-Fetch-Site");
  if (request.headers.get("Origin") !== url.origin || (site !== null && site !== "same-origin")) {
    return jsonError(403, "same-origin requests only");
  }

  if (!(request.headers.get("Content-Type") ?? "").startsWith("application/json")) {
    return jsonError(415, "expected application/json");
  }

  const secret = env.TURNSTILE_SECRET;
  if (!secret) {
    console.error("human-check: TURNSTILE_SECRET is not set; the page lets visitors through");
    return jsonError(503, "human check not configured");
  }

  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) return jsonError(413, "body too large");

  // Parsed here, not left to the router's catch-all: a SyntaxError message
  // quotes part of its input, and that input is the token.
  let token: unknown;
  try {
    token = (JSON.parse(raw) as { token?: unknown } | null)?.token;
  } catch {
    return jsonError(400, "invalid json");
  }
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return jsonError(400, `token must be a string of 1-${MAX_TOKEN_LENGTH} characters`);
  }
  if (token === TEST_TOKEN && !TEST_SECRETS.has(secret)) {
    console.error("human-check: a test widget's token reached the real secret; is the site served on another hostname?");
    return jsonError(503, "test widget against a production secret");
  }

  const form = new URLSearchParams({ secret, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);

  let upstream: Response;
  try {
    upstream = await fetch(SITEVERIFY, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn("human-check: siteverify unreachable", err instanceof Error ? err.name : "error");
    return jsonError(502, "siteverify unreachable");
  }
  if (!upstream.ok) {
    console.warn("human-check: siteverify error", { status: upstream.status });
    return jsonError(502, "siteverify error");
  }
  let outcome: Siteverify;
  try {
    outcome = (await upstream.json()) as Siteverify;
  } catch {
    return jsonError(502, "siteverify sent invalid JSON");
  }
  if (typeof outcome !== "object" || outcome === null) {
    return jsonError(502, "siteverify sent an unexpected shape");
  }

  if (outcome.success !== true) {
    const codes = errorCodes(outcome["error-codes"]);
    console.warn("human-check: rejected", { codes });
    return json({ ok: false, error: "rejected", codes }, 403);
  }

  // A valid token for a different action, or minted on another hostname the
  // widget also allows, is still not a pass for this page.
  if (!TEST_SECRETS.has(secret)) {
    if (outcome.action !== HUMAN_CHECK_ACTION) {
      console.warn("human-check: action mismatch");
      return json({ ok: false, error: "rejected", codes: ["action-mismatch"] }, 403);
    }
    if (outcome.hostname !== url.hostname) {
      console.warn("human-check: hostname mismatch");
      return json({ ok: false, error: "rejected", codes: ["hostname-mismatch"] }, 403);
    }
  }

  return json({ ok: true, ttl: HUMAN_CHECK_TTL_SECONDS }, 200);
}
