import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, SessionExpiredError } from "./api";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(response: Response | (() => Promise<Response>)) {
  const fn = vi.fn<Fetch>(typeof response === "function" ? response : async () => response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

/** What fetch() returns for a redirect it was told not to follow. */
function opaqueRedirect(): Response {
  const res = new Response(null, { status: 200 });
  Object.defineProperty(res, "type", { value: "opaqueredirect" });
  Object.defineProperty(res, "status", { value: 0 });
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api()", () => {
  it("calls the API under /admin, inside the page's own Access application", async () => {
    const fetch = stubFetch(json({ ok: true }));
    await api("queue?status=pending");
    // Not /api/admin/*: behind a second Access application, the reviewer's
    // session for /admin never covered it and every call came back as a login
    // redirect, reported as an expired session right after signing in.
    expect(fetch.mock.calls[0][0]).toBe("/admin/api/queue?status=pending");
  });

  it("asks fetch not to follow redirects, same-origin only", async () => {
    const fetch = stubFetch(json({ ok: true }));
    await api("me");
    const init = fetch.mock.calls[0][1] as RequestInit;
    // Following Access's login redirect from fetch() is what produced the
    // cloudflareaccess.com connect-src violations on the old pages.
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("same-origin");
  });

  it("sends JSON bodies with a JSON content type", async () => {
    const fetch = stubFetch(json({ ok: true }));
    await api("decide", { method: "POST", body: { ids: ["a"], action: "approve" } });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"ids":["a"],"action":"approve"}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it.each([
    ["an opaque redirect", opaqueRedirect],
    ["a 401", () => json({ error: "no" }, 401)],
    ["a 403", () => json({ error: "no" }, 403)],
  ])("treats %s as an expired session", async (_label, make) => {
    stubFetch(make());
    await expect(api("queue")).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("reports a non-JSON body as a server problem, not an expired session", async () => {
    stubFetch(new Response("<html>1101</html>", { status: 500, headers: { "Content-Type": "text/html" } }));
    const err = await api("queue").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(SessionExpiredError);
    expect((err as ApiError).status).toBe(500);
  });

  it("surfaces the server's error message", async () => {
    stubFetch(json({ error: "commit failed: graphql HTTP 502" }, 502));
    await expect(api("decide", { method: "POST", body: {} })).rejects.toThrow("commit failed: graphql HTTP 502");
  });

  it("returns the body of an accepted non-2xx status", async () => {
    stubFetch(json({ ok: false, github: "503" }, 503));
    await expect(api("health", { accept: [503] })).resolves.toEqual({ ok: false, github: "503" });
  });

  it("turns a network failure into a readable error", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api("queue")).rejects.toThrow(/could not be reached/);
  });

  it("lets an abort propagate as an abort", async () => {
    const controller = new AbortController();
    controller.abort();
    stubFetch(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(api("queue", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
