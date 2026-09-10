/**
 * GitHub App installation tokens.
 *
 * The App's private key never expires; the tokens it mints live about an hour.
 * That is the whole reason for using an App rather than a PAT — a silently
 * expired PAT is what stalled this project's pipeline for a month.
 *
 * Nothing here is reachable without a verified Access identity. See
 * routes/admin.ts, which authenticates BEFORE any of this runs.
 */

const GH_API = "https://api.github.com";
const UA = "f2p-tracker-worker";

/** Cached per isolate. GitHub tokens last ~60 min; refresh with margin. */
let tokenCache: { token: string; expiresAt: number } | null = null;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** DER length prefix for a given payload length. */
function derLen(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/**
 * GitHub issues PKCS#1 keys ("BEGIN RSA PRIVATE KEY"). Web Crypto imports only
 * PKCS#8. PKCS#8 is a thin ASN.1 wrapper around the same key material, so wrap
 * it rather than making the operator run openssl by hand — a conversion step in
 * a runbook is a step someone eventually skips.
 *
 * A key already in PKCS#8 form ("BEGIN PRIVATE KEY") is passed through.
 */
function pemToPkcs8(pem: string): Uint8Array {
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  const body = pem
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "")
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  if (!isPkcs1) return der;

  // AlgorithmIdentifier for rsaEncryption, with its NULL parameters.
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7,
                 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLen(der.length)];
  const inner = algId.length + octet.length + der.length + 3; // +3 for INTEGER 0
  const out = new Uint8Array([
    0x30, ...derLen(inner),
    0x02, 0x01, 0x00,          // version 0
    ...algId,
    ...octet,
  ]);
  const full = new Uint8Array(out.length + der.length);
  full.set(out, 0);
  full.set(der, out.length);
  return full;
}

/** App-level JWT: proves we hold the private key. Max lifetime 10 minutes. */
async function appJwt(env: Env): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(env.GH_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(
    new TextEncoder().encode(
      // iat backdated 60s: GitHub rejects tokens whose iat is in the future,
      // and Workers' clock can sit slightly ahead of GitHub's.
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GH_APP_ID }),
    ),
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(sig)}`;
}

/** Installation token, cached until shortly before it expires. */
export async function installationToken(env: Env): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - now > 5 * 60 * 1000) return tokenCache.token;

  const jwt = await appJwt(env);
  const res = await fetch(
    `${GH_API}/app/installations/${env.GH_APP_INSTALLATION_ID}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": UA,
      },
    },
  );
  if (!res.ok) {
    throw new Error(`installation token: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string; expires_at: string };
  tokenCache = { token: body.token, expiresAt: Date.parse(body.expires_at) };
  return body.token;
}

/** Authenticated GitHub request using the installation token. */
export async function gh(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await installationToken(env);
  return fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
    },
  });
}
