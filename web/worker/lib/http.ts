/** Shared response helpers. Worker-generated responses do NOT inherit rules
 *  from public/_headers, so anything set there must be re-applied here. */

/**
 * Security headers applied to every Worker-generated response.
 *
 * Kept in step with web/public/_headers, which covers static assets only.
 * Anything added there that must also hold for API responses belongs here too;
 * neither file inherits from the other.
 *
 * No CSP here: these are JSON and image responses, not documents, so a policy
 * would govern nothing. The two HTML responses the Worker does produce
 * (/admin and /admin/edit) build their own nonce CSP instead. What IS worth
 * setting on a JSON body is a frame/sniff/embed lockdown, which is what these
 * do.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  // Deliberately NO Cross-Origin-Resource-Policy. The Tauri desktop and
  // Android builds run on tauri://localhost and fetch /api/data/* and /img/*
  // from this origin cross-site (see SITE_ORIGIN in src/lib/fetcher.ts and
  // src/lib/image.ts), so `same-site` would blank every image and stop the
  // catalogue loading in the packaged apps. web/public/_headers can and does
  // set it, because those static assets are only ever loaded by this site.
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), " +
    "encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), " +
    "microphone=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()",
};

export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

/**
 * Steam serves capsule art from two hosts, and roughly 44% of the catalogue
 * uses the fastly one. Allowlisting only akamai is a mistake this repo has
 * already made once, in the service-worker cache rules.
 */
const ADMIN_IMG_HOSTS = [
  "https://shared.akamai.steamstatic.com",
  "https://shared.fastly.steamstatic.com",
  "https://cdn.akamai.steamstatic.com",
].join(" ");

/**
 * The admin pages' Content-Security-Policy.
 *
 * This was duplicated byte-for-byte in admin-ui.ts and edit-ui.ts, which is one
 * copy too many for the policy protecting the only origin that holds a
 * repository-write credential: a hardening change applied to one file and not
 * the other is invisible.
 *
 * `default-src 'none'` already denies fonts, media, workers, frames and
 * objects by fallback. object-src is repeated explicitly anyway because it is
 * the directive whose absence has the worst consequences and the one a reader
 * will look for. Note there is deliberately no font-src: these pages use the
 * system stack, and the directive should appear the day a font is actually
 * served, not before.
 */
function adminCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    `img-src ${ADMIN_IMG_HOSTS} data:`,
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Response wrapper for the two HTML pages the Worker serves.
 *
 * Carries the nonce CSP plus SECURITY_HEADERS, and adds
 * Cross-Origin-Opener-Policy, which public/_headers sets for the SPA but which
 * the admin pages were missing - so an admin window opened from elsewhere
 * stayed in the opener's browsing-context group.
 */
export function adminHtmlResponse(body: string, nonce: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Per-identity and mutable; never let this sit in any cache.
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Security-Policy": adminCsp(nonce),
      "Cross-Origin-Opener-Policy": "same-origin",
      ...SECURITY_HEADERS,
    },
  });
}

/**
 * Clamp a caller-supplied `limit` query parameter.
 *
 * Every call site used to be `Math.min(Number(v) || fallback, max)`, which has
 * no lower bound. `Number("-1")` is -1, which is truthy, so `|| fallback` never
 * fires and `Math.min(-1, max)` is -1 - and **SQLite treats a negative LIMIT as
 * no limit at all**. `?limit=-1` therefore dumped the entire table:
 * `/api/admin/audit?limit=-1` returned the whole, never-pruned audit log.
 *
 * Math.trunc as well, because a fractional LIMIT is not a valid bind value.
 */
export function clampLimit(raw: string | null, fallback: number, max: number): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** Same shape for `offset`, which was already clamped but not truncated. */
export function clampOffset(raw: string | null, max = 1_000_000): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

export function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Never let an error response be cached as if it were content.
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}
