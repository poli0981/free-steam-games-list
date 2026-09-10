/** Shared response helpers. Worker-generated responses do NOT inherit rules
 *  from public/_headers, so anything set there must be re-applied here. */

/** Security headers applied to every Worker-generated response. */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
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
