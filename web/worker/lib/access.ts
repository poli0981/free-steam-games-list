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

/** JWKS changes rarely; cache per isolate to avoid a fetch on every request. */
let jwksCache: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access JWKS: ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };

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
 * Returns the verified identity, or null. Never throws for an untrusted token —
 * callers treat null as "deny" and must not distinguish failure modes to the
 * client.
 */
export async function verifyAccessJwt(
  request: Request,
  env: Env,
): Promise<AccessIdentity | null> {
  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    // Access also sets a cookie; the header is authoritative but the cookie is
    // what a browser navigation carries.
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1] ??
    null;
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = decodeJson(parts[0]);
    const kid = typeof header.kid === "string" ? header.kid : null;
    if (!kid || header.alg !== "RS256") return null;

    const keys = await getKeys(env.ACCESS_TEAM_DOMAIN);
    const key = keys.get(kid);
    if (!key) return null;

    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;

    const claims = decodeJson(parts[1]);

    // aud pins the token to THIS application. Without it, a valid token minted
    // for any other application in the same Access org would be accepted here.
    const aud = claims.aud;
    const audList = Array.isArray(aud) ? aud : [aud];
    if (!audList.includes(env.ACCESS_AUD)) return null;

    if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === "number" && claims.exp < now) return null;
    if (typeof claims.nbf === "number" && claims.nbf > now) return null;

    const email = typeof claims.email === "string" ? claims.email : null;
    const commonName = typeof claims.common_name === "string" ? claims.common_name : null;

    // Service tokens carry common_name instead of email.
    if (email) return { email, isServiceToken: false };
    if (commonName) return { email: commonName, isServiceToken: true };
    return null;
  } catch {
    return null;
  }
}
