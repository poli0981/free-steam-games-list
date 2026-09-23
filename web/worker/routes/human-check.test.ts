import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleHumanCheck } from "./human-check";
import {
  HUMAN_CHECK_ACTION,
  HUMAN_CHECK_PATH,
  HUMAN_CHECK_TTL_SECONDS,
  type HumanCheckReply,
} from "../../shared/human-check";

/**
 * The Turnstile token check. It answers yes or no and nothing else, so what
 * matters is that each "no" is the right kind of no: 403 only when Cloudflare
 * (or the action/hostname) refuses, 503/502 when the fault is this site's -
 * the page lets people through on those - and never a CORS header.
 */

const ORIGIN = "https://free-steam-games.win";
const SECRET = "0x-production-secret-under-test";
const TOKEN = "0.a-widget-token-under-test";
const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const IP = "203.0.113.7";

const envWith = (secret?: string) => ({ TURNSTILE_SECRET: secret }) as unknown as Env;

interface CallOptions {
  method?: string;
  headers?: Record<string, string>;
  omit?: string[];
  raw?: string;
}

function call(body: unknown = { token: TOKEN }, opts: CallOptions = {}, env = envWith(SECRET)) {
  const url = new URL(`${ORIGIN}${HUMAN_CHECK_PATH}`);
  const headers = new Headers({
    Origin: ORIGIN,
    "Sec-Fetch-Site": "same-origin",
    "Content-Type": "application/json",
    "CF-Connecting-IP": IP,
    ...opts.headers,
  });
  for (const name of opts.omit ?? []) headers.delete(name);
  const method = opts.method ?? "POST";
  const hasBody = method !== "GET" && method !== "HEAD";
  const request = new Request(url, {
    method,
    headers,
    body: hasBody ? (opts.raw ?? JSON.stringify(body)) : undefined,
  });
  return handleHumanCheck(request, url, env);
}

const verified = (fields: Record<string, unknown> = {}) =>
  Response.json({ success: true, hostname: "free-steam-games.win", action: HUMAN_CHECK_ACTION, ...fields });

let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what the route refuses before asking Cloudflare", () => {
  it("answers only POST", async () => {
    for (const method of ["GET", "HEAD", "PUT"]) {
      expect((await call(undefined, { method })).status, method).toBe(405);
    }
  });

  it("refuses a request with no Origin, a foreign one, or another site's browser", async () => {
    expect((await call(undefined, { omit: ["Origin"] })).status).toBe(403);
    expect((await call(undefined, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await call(undefined, { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("still accepts a same-origin call that carries no Sec-Fetch-Site", async () => {
    upstream.mockResolvedValue(verified());
    expect((await call(undefined, { omit: ["Sec-Fetch-Site"] })).status).toBe(200);
  });

  it("wants JSON", async () => {
    expect((await call(undefined, { headers: { "Content-Type": "text/plain" } })).status).toBe(415);
  });

  it("answers 503, and never calls siteverify, when the secret is not set", async () => {
    const res = await call(undefined, {}, envWith(undefined));
    expect(res.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("caps the body by what arrives, not only by what Content-Length claims", async () => {
    // Node's Request sets no Content-Length for a string body, so this is the
    // stream path - the one a chunked request would take.
    const res = await call(undefined, { raw: JSON.stringify({ token: "x".repeat(5000) }) });
    expect(res.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses bad JSON and anything that is not a 1-2048 character token", async () => {
    expect((await call(undefined, { raw: "{not json" })).status).toBe(400);
    for (const body of [{}, { token: "" }, { token: 42 }, { token: "x".repeat(2049) }, null]) {
      expect((await call(body)).status, JSON.stringify(body)?.slice(0, 40)).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("the siteverify call", () => {
  it("posts the secret, the token and the visitor's IP, with a timeout", async () => {
    upstream.mockResolvedValue(verified());
    await call();
    expect(upstream).toHaveBeenCalledTimes(1);
    const [target, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(target).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("secret")).toBe(SECRET);
    expect(form.get("response")).toBe(TOKEN);
    expect(form.get("remoteip")).toBe(IP);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("leaves remoteip out when the edge supplied none", async () => {
    upstream.mockResolvedValue(verified());
    await call(undefined, { omit: ["CF-Connecting-IP"] });
    const [, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(new URLSearchParams(String(init.body)).has("remoteip")).toBe(false);
  });
});

describe("the answer", () => {
  it("passes a verified token for this action and hostname, uncached and without CORS", async () => {
    upstream.mockResolvedValue(verified());
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ttl: HUMAN_CHECK_TTL_SECONDS });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("refuses what Cloudflare refused, passing on only Cloudflare's own error strings", async () => {
    upstream.mockResolvedValue(
      Response.json({ success: false, "error-codes": ["invalid-input-response", 42, "<script>"] }),
    );
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "rejected", codes: ["invalid-input-response"] });
  });

  it("refuses a valid token minted for another action or on another hostname", async () => {
    const codesOf = async (res: Response) => ((await res.json()) as HumanCheckReply).codes;

    upstream.mockResolvedValue(verified({ action: "login" }));
    const wrongAction = await call();
    expect(wrongAction.status).toBe(403);
    expect(await codesOf(wrongAction)).toEqual(["action-mismatch"]);

    upstream.mockResolvedValue(verified({ hostname: "evil.example" }));
    const wrongHost = await call();
    expect(wrongHost.status).toBe(403);
    expect(await codesOf(wrongHost)).toEqual(["hostname-mismatch"]);
  });

  it("accepts Cloudflare's fixed test answer only under a published test secret", async () => {
    const dummy = () => Response.json({ success: true, hostname: "localhost", action: "test" });
    upstream.mockImplementation(async () => dummy());
    const testSecret = envWith("1x0000000000000000000000000000000AA");
    expect((await call({ token: TEST_TOKEN }, {}, testSecret)).status).toBe(200);
    expect((await call()).status).toBe(403);
  });

  it("treats a test widget's token against the real secret as a setup fault, not a refusal", async () => {
    // The page uses the test key on any hostname but production; if the real
    // Worker serves it somewhere else, every visitor would otherwise be refused.
    const res = await call({ token: TEST_TOKEN });
    expect(res.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers 502 when siteverify is unreachable, failing or garbled", async () => {
    upstream.mockRejectedValueOnce(new TypeError("network"));
    expect((await call()).status).toBe(502);
    upstream.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    expect((await call()).status).toBe(502);
    upstream.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    expect((await call()).status).toBe(502);
    upstream.mockResolvedValueOnce(Response.json(null));
    expect((await call()).status).toBe(502);
  });

  it("never logs the token or the visitor's IP", async () => {
    const logged: unknown[][] = [];
    for (const level of ["log", "warn", "error", "info"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args));
    }
    upstream.mockResolvedValueOnce(Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    await call();
    upstream.mockResolvedValueOnce(verified({ action: "other" }));
    await call();
    upstream.mockRejectedValueOnce(new TypeError(`fetch failed for ${TOKEN}`));
    await call();
    upstream.mockResolvedValueOnce(new Response("x", { status: 503 }));
    await call();
    await call(undefined, {}, envWith(undefined));

    expect(logged.length).toBeGreaterThan(0);
    const text = JSON.stringify(logged);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(IP);
  });
});
