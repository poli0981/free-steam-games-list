/**
 * Per-IP request limits: the Worker's half of rate limiting.
 *
 * The FIRST layer is the zone's WAF rate-limiting rule (docs/SECURITY_SETUP.md
 * section 3). It refuses a burst at the edge before this Worker is invoked, so
 * a flood it catches costs no invocation, no subrequest and no R2 read. The
 * Free plan gives the zone exactly one such rule and fixes its shape: count by
 * IP over 10 seconds, block for 10. This layer adds what that rule cannot - a
 * 60-second window, so a client pacing itself just under the 10-second
 * threshold is still stopped, and a budget per surface, because a human check
 * is not an image - and it keeps holding if the WAF rule is edited or deleted.
 *
 * Like BLOCKED_COUNTRIES (lib/geo.ts) it sees only the four
 * `run_worker_first` prefixes. The prerendered pages never reach the Worker;
 * the WAF rule is all that limits them.
 *
 * The limits are `ratelimits` bindings in wrangler.jsonc, one per class below.
 * Cloudflare counts per location and approximately (a few requests over the
 * limit can pass), so a limit here is a ceiling for abuse, never an accurate
 * quota - every number sits well above what a person, the apps or the
 * discovery workflow sends.
 *
 * FAIL OPEN. A missing binding (Vitest, `admin/mock`, a config that lost one),
 * a request without CF-Connecting-IP, or a limit() call that throws lets the
 * request through: the WAF rule is the boundary, and this must never be the
 * reason the catalogue does not load.
 *
 * Refusals are not logged. Workers Logs already records every invocation with
 * its status, and a console line per refused request would double the log
 * volume of exactly the floods this exists for. Filter on status 429.
 */
import { HUMAN_CHECK_PATH } from "../../shared/human-check";
import { ADMIN_API_PREFIX } from "../../shared/admin-routes";
import { errorText, jsonError } from "./http";

export type LimitClass = "data" | "img" | "api" | "human" | "admin";

/** The wrangler.jsonc `ratelimits` binding behind each class. */
export const LIMIT_BINDINGS = {
  data: "RL_DATA",
  img: "RL_IMG",
  api: "RL_API",
  human: "RL_HUMAN",
  admin: "RL_ADMIN",
} as const satisfies Record<LimitClass, keyof Env>;

/**
 * Every binding's `period`, and so the Retry-After of a refusal. The binding
 * cannot report when its window ends, so this is the honest upper bound.
 * rate-limit.test.ts holds wrangler.jsonc to it.
 */
export const LIMIT_PERIOD_SECONDS = 60;

/**
 * The classes whose routes answer cross-origin (`/api/data/*`, `/api/activity`),
 * so their refusal does too: without the header the packaged apps would see a
 * CORS failure where there is a 429. Never `human` or `admin` - those routes
 * are same-origin by design (CLAUDE.md), and `/img/*` sends no CORS at all.
 */
const CORS_CLASSES: ReadonlySet<LimitClass> = new Set(["data", "api"]);

/** Which budget a path draws on, or null for a path no limit covers. */
export function limitClass(pathname: string): LimitClass | null {
  if (pathname.startsWith("/api/data/")) return "data";
  if (pathname.startsWith("/img/")) return "img";
  if (pathname === HUMAN_CHECK_PATH) return "human";
  if (
    pathname.startsWith("/api/ingest/") ||
    pathname.startsWith(ADMIN_API_PREFIX) ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  ) {
    return "admin";
  }
  if (pathname.startsWith("/api/")) return "api";
  return null;
}

/**
 * The counter a request is charged to: its IPv4 address, or its IPv6 /64.
 *
 * An IPv6 subscriber is normally handed a whole /64, so counting full
 * addresses would give one client 2^64 fresh budgets. A NAT'd IPv4 address
 * can stand for many people (mobile carriers use CGNAT widely), which is why
 * the limits are generous rather than why the key is different.
 */
export function clientKey(request: Request): string | null {
  const ip = request.headers.get("CF-Connecting-IP")?.trim().toLowerCase();
  if (!ip) return null;
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];
  return ipv6Prefix64(ip) ?? ip;
}

/** `2001:db8:a:b:1:2:3:4` -> `2001:db8:a:b::/64`; null if it is not IPv6. */
function ipv6Prefix64(ip: string): string | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const groups = (s: string | undefined) => (s ? s.split(":") : []);
  // A trailing dotted quad (`::ffff:1.2.3.4`, `64:ff9b::1.2.3.4`) is two groups.
  const width = (gs: string[]) => gs.reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0);
  const left = groups(halves[0]);
  const right = groups(halves[1]);
  const missing = 8 - width(left) - width(right);
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...left, ...Array<string>(halves.length === 1 ? 0 : missing).fill("0"), ...right];
  const prefix = all.slice(0, 4);
  if (!prefix.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${prefix.map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** The refusal: JSON like every other Worker error, never cached. */
export function tooManyRequests(cls: LimitClass): Response {
  const res = jsonError(429, "too many requests");
  res.headers.set("Retry-After", String(LIMIT_PERIOD_SECONDS));
  if (CORS_CLASSES.has(cls)) res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}

/**
 * Charge the request to its class's budget. Returns the 429 to send when the
 * budget is spent, or null to carry on (including every fail-open case).
 */
export async function rateLimited(request: Request, pathname: string, env: Env): Promise<Response | null> {
  const cls = limitClass(pathname);
  if (!cls) return null;
  // Typed as always bound; at runtime it is not, under Vitest and admin/mock.
  const limiter: RateLimit | undefined = env[LIMIT_BINDINGS[cls]];
  const key = clientKey(request);
  if (!limiter || !key) return null;
  try {
    const { success } = await limiter.limit({ key });
    return success ? null : tooManyRequests(cls);
  } catch (err) {
    console.error("rate-limit: limiter failed, letting the request through", { cls, message: errorText(err) });
    return null;
  }
}
