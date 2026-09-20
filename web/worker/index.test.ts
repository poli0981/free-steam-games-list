/**
 * The admin gate in worker/index.ts, end to end: a real RS256 token, verified
 * against a stubbed Access JWKS, through the same dispatch production runs.
 *
 * The admin API lives under /admin (ADMIN_API_PREFIX, shared/admin-routes.ts).
 * At /api/admin/* it sat behind a second Access application, whose session a
 * reviewer signed in to /admin never held: every call bounced to the login
 * page, while every test that called the handlers directly still passed. These
 * go through the router, so they would not have.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { makeEnv } from "./testing/fixtures";

vi.mock("./generated/admin-bundle", () => ({
  ADMIN_BUNDLE: {
    buildId: "test-build",
    shell: '<!doctype html><script type="module" nonce="__ADMIN_NONCE__" src="/admin/assets/app-1.js"></script>',
    assets: {},
  },
}));

const env = makeEnv();
const TEAM = env.ACCESS_TEAM_DOMAIN;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

let signingKey: CryptoKey;

const b64url = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");

async function token(claims: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "test-kid", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ aud: [env.ACCESS_AUD_ADMIN], email: "you@example.com", iss: `https://${TEAM}`, exp: now + 3600, ...claims }),
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(signature))}`;
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  signingKey = pair.privateKey;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const certs = { keys: [{ kid: "test-kid", kty: "RSA", alg: "RS256", n: jwk.n, e: jwk.e }] };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input) === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json(certs);
    throw new Error(`unexpected fetch: ${String(input)}`);
  });
});

function call(path: string, init: { method?: string; header?: string; cookie?: string } = {}) {
  const headers = new Headers();
  if (init.header) headers.set("Cf-Access-Jwt-Assertion", init.header);
  if (init.cookie) headers.set("Cookie", `CF_Authorization=${init.cookie}`);
  const request = new Request(`https://free-steam-games.win${path}`, { method: init.method ?? "GET", headers });
  return worker.fetch(request, env, ctx);
}

describe("the admin API under /admin", () => {
  it("answers a signed-in reviewer at /admin/api/*", async () => {
    const res = await call("/admin/api/me", { header: await token() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "you@example.com", isServiceToken: false });
  });

  it("accepts the session cookie on a read, as a page load carries it", async () => {
    const res = await call("/admin/api/me", { cookie: await token() });
    expect(res.status).toBe(200);
  });

  it("still demands the Access header on a write, never the cookie alone", async () => {
    // The CSRF control: a browser attaches the cookie cross-site, never the header.
    const res = await call("/admin/api/ping", { method: "POST", cookie: await token() });
    expect(res.status).toBe(404);
  });

  it("answers an unauthenticated call as the API does, not with the app shell", async () => {
    const res = await call("/admin/api/queue");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("refuses a token minted for another Access application", async () => {
    const res = await call("/admin/api/me", { header: await token({ aud: [env.ACCESS_AUD_INGEST] }) });
    expect(res.status).toBe(404);
  });

  it("no longer serves anything at the old /api/admin/* prefix", async () => {
    const res = await call("/api/admin/me", { header: await token() });
    expect(res.status).toBe(404);
  });

  it("still serves the SPA shell for the page itself", async () => {
    const res = await call("/admin", { cookie: await token() });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});

describe("the country block", () => {
  /** makeEnv() sets no BLOCKED_COUNTRIES, which is why every test above is
   *  unaffected by this. Here it is set, as wrangler.jsonc sets it. */
  const blocking = { ...makeEnv(), BLOCKED_COUNTRIES: "CN,RU,AR" } as unknown as Env;

  const from = (country: string | null, path = "/api/activity") =>
    worker.fetch(
      new Request(`https://free-steam-games.win${path}`, {
        headers: country ? { "CF-IPCountry": country } : {},
      }),
      blocking,
      ctx,
    );

  it("refuses a listed country before any route runs", async () => {
    const res = await from("CN");
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    // Applied ahead of the admin block too, not only the public routes.
    expect((await from("RU", "/admin/api/me")).status).toBe(403);
  });

  it("carries the security headers - this was the other 404 path's bug", async () => {
    expect((await from("AR")).headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("lets everyone else through, including an unknown country", async () => {
    expect((await from("VN")).status).not.toBe(403);
    expect((await from(null)).status).not.toBe(403);
  });
});
