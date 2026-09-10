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
