/**
 * Cloudflare Access JWT verification.
 *
 * Access already gates /admin at the edge, so why verify again? Because the
 * path is not the boundary — the credential behind it is. Anything that
 * reaches the Worker outside the zone-scoped Access application (a
 * misconfigured route, a preview hostname, a future refactor) would otherwise
 * arrive unauthenticated at code holding a repository-write credential.
 * Verifying here means the Worker is safe even if the edge policy is wrong.
 */

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
}

export interface AccessIdentity {
  /** Access-verified email, or the service-token name for machine callers. */
  email: string;
  /** True when the caller authenticated with a service token, not a human login. */
  isServiceToken: boolean;
}

/**
 * Cloudflare's signing keys were unreachable.
 *
 * Distinct from "this token is bad" so callers can answer 503 instead of 404.
 * Previously both collapsed into null, which meant a Cloudflare outage looked
 * exactly like an invalid token and there was nothing in the response to tell
 * them apart.
 */
export class AccessUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessUnavailableError";
  }
}

/** JWKS changes rarely; cache per isolate to avoid a fetch on every request. */
let jwksCache: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

/**
 * Floor between forced refetches, so an unknown `kid` cannot be used to make
 * this Worker hammer Cloudflare: a flood of tokens carrying junk kids would
 * otherwise trigger one upstream fetch each.
 */
const JWKS_REFRESH_FLOOR_MS = 60 * 1000;
let lastForcedFetch = 0;

async function getKeys(teamDomain: string, force = false): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (!force && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;

  let res: Response;
  try {
    res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  } catch (err) {
    throw new AccessUnavailableError(
      `Access JWKS unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) throw new AccessUnavailableError(`Access JWKS: ${res.status}`);
  let parsed: { keys?: Jwk[] };
  try {
    parsed = (await res.json()) as { keys?: Jwk[] };
  } catch {
    throw new AccessUnavailableError("Access JWKS: invalid JSON");
  }
  const keys = parsed.keys ?? [];

  const map = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA" || jwk.alg !== "RS256") continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    map.set(jwk.kid, key);
  }
  jwksCache = { keys: map, fetchedAt: now };
  return map;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    s.length + ((4 - (s.length % 4)) % 4),
    "=",
  );
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>;
}

/**
 * Returns the verified identity, or null.
 *
 * Never throws for an UNTRUSTED token — callers treat null as "deny" and must
 * not distinguish failure modes to the client. It does throw
 * AccessUnavailableError when Cloudflare's signing keys cannot be fetched,
 * which is an outage rather than a decision and deserves a 503.
 */
export async function verifyAccessJwt(
  request: Request,
  env: Env,
  /**
   * Comma-separated AUDs acceptable FOR THIS ROUTE. Passed in per call rather
   * than read from one global list: this Worker sits behind three Access
   * applications, and a single union list means any of the three credentials
   * satisfies any route — an admin session could drive /api/ingest/*, and the
   * unattended discovery token could drive /api/admin/*, which holds a
   * repository-write credential. Scoping the AUD to the route makes that
   * crossing impossible rather than merely checked for afterwards.
   */
  allowedAud: string,
  opts: { headerOnly?: boolean } = {},
): Promise<AccessIdentity | null> {
  // Access sets BOTH a Cf-Access-Jwt-Assertion header and a CF_Authorization
  // cookie. The cookie is what a top-level browser navigation carries, so it
  // has to be accepted for the /admin page itself.
  //
  // For state-changing requests it must not be. A cookie is attached by the
  // browser to cross-site requests too, so accepting it there made the
  // Sec-Fetch-Site sniff in worker/index.ts the only thing standing between a
  // stolen or forced cross-site POST and a repository write - and that sniff
  // is deliberately fail-open for non-browser callers. The header is never
  // attached by a browser on its own, so requiring it here is a CSRF control
  // that does not depend on a heuristic. curl and the discovery service token
  // send the header explicitly and are unaffected.
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  const cookie = opts.headerOnly
    ? null
    : /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1] ?? null;
  const token = header ?? cookie;
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = decodeJson(parts[0]);
    const kid = typeof header.kid === "string" ? header.kid : null;
    if (!kid || header.alg !== "RS256") return null;

    let keys = await getKeys(env.ACCESS_TEAM_DOMAIN);
    let key = keys.get(kid);
    if (!key) {
      // Cloudflare rotates its signing keys. With a 1-hour cache and no
      // refetch, a rotation locked out admin AND ingest for up to an hour, as
      // an opaque 404 with nothing in the logs to explain it. Refetch once,
      // rate-limited, before concluding the token is forged.
      const now = Date.now();
      if (now - lastForcedFetch >= JWKS_REFRESH_FLOOR_MS) {
        lastForcedFetch = now;
        keys = await getKeys(env.ACCESS_TEAM_DOMAIN, true);
        key = keys.get(kid);
      }
      if (!key) {
        console.warn("access: unknown kid", { kid });
        return null;
      }
    }

    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;

    const claims = decodeJson(parts[1]);

    // aud pins the token to a KNOWN application. Without this check, a token
    // minted for any other application in the same Access organisation would
    // be accepted here.
    //
    // Each Access application has its own AUD tag, so this is a list even for
    // one route group. Configuring only /admin's tag once made every API call
    // fail verification while the page itself worked — and both failures
    // surfaced as an identical 404.
    const allowed = allowedAud.split(",").map((a) => a.trim()).filter(Boolean);
    const aud = claims.aud;
    const audList = (Array.isArray(aud) ? aud : [aud]).filter(
      (a): a is string => typeof a === "string",
    );
    if (!audList.some((a) => allowed.includes(a))) {
      // Visible in Workers Logs only; the client still gets an opaque 404.
      console.warn("access: aud mismatch", { got: audList, allowed });
      return null;
    }

    if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;

    // exp is REQUIRED, not merely honoured when present. The previous form
    // (`typeof claims.exp === "number" && claims.exp < now`) accepted a token
    // with no exp, or with exp as a string, and such a token then never
    // expired. Cloudflare always sets it, so demanding it costs nothing and
    // removes the one shape that would have been immortal.
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== "number" || claims.exp < now) {
      console.warn("access: missing or expired exp");
      return null;
    }
    // nbf is optional, but if it is present it must be a number - the same
    // typeof-guard trap, where a string nbf silently skipped the check.
    if ("nbf" in claims) {
      if (typeof claims.nbf !== "number" || claims.nbf > now) return null;
    }

    const email = typeof claims.email === "string" ? claims.email : null;
    const commonName = typeof claims.common_name === "string" ? claims.common_name : null;

    // Service tokens carry common_name instead of email.
    if (email) return { email, isServiceToken: false };
    if (commonName) return { email: commonName, isServiceToken: true };
    return null;
  } catch (err) {
    // An outage must reach the caller so it can answer 503. Everything else -
    // malformed base64, bad JSON, a forged signature - is a deny.
    if (err instanceof AccessUnavailableError) throw err;
    return null;
  }
}
