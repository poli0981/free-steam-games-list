import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleData } from "./data";

/**
 * The versioned shard path serves bytes ONLY when they hash to the version the
 * index recorded. Anything else - a CDN still holding the previous shard - is a
 * 503, never the wrong content under the new generation's key.
 */

const ORIGIN = "https://free-steam-games.win";
const SHARD = "data/data_001.jsonl";

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

class FakeCache {
  store = new Map<string, Response>();
  async match(req: Request): Promise<Response | undefined> {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response): Promise<void> {
    this.store.set(req.url, res.clone());
  }
}

function ctx() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
    settle: () => Promise.all(pending),
  };
}

function call(path: string, c = ctx()) {
  const url = new URL(`${ORIGIN}/api/data/${path}`);
  return { c, res: handleData(new Request(url), url, c as unknown as ExecutionContext) };
}

let cache: FakeCache;
let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cache = new FakeCache();
  vi.stubGlobal("caches", { default: cache });
  upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("versioned shards", () => {
  const body = '{"link":"https://store.steampowered.com/app/730/"}\n';

  it("serves matching bytes, immutable, with CORS", async () => {
    upstream.mockResolvedValue(new Response(body));
    const v = await sha256Hex(body);
    const { c, res } = call(`${SHARD}?v=${v}`);
    const r = await res;
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(body);
    expect(r.headers.get("Cache-Control")).toContain("immutable");
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await c.settle();
    expect(cache.store.size).toBe(1);
  });

  it("answers a second request from the cache without touching GitHub", async () => {
    upstream.mockResolvedValue(new Response(body));
    const v = await sha256Hex(body);
    const first = call(`${SHARD}?v=${v}`);
    await first.res;
    await first.c.settle();
    const second = await call(`${SHARD}?v=${v}`).res;
    expect(await second.text()).toBe(body);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("refuses bytes that do not match, and does not cache them", async () => {
    upstream.mockResolvedValue(new Response("the previous shard\n"));
    const v = await sha256Hex(body);
    const { c, res } = call(`${SHARD}?v=${v}`);
    const r = await res;
    expect(r.status).toBe(503);
    expect(r.headers.get("Retry-After")).toBe("30");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await c.settle();
    // Only the short-lived mismatch marker, never the content.
    expect([...cache.store.keys()].every((k) => k.includes("mismatch=1"))).toBe(true);
  });

  it("throttles upstream refetches while a mismatch is remembered", async () => {
    upstream.mockResolvedValue(new Response("stale\n"));
    const v = await sha256Hex(body);
    const first = call(`${SHARD}?v=${v}`);
    await first.res;
    await first.c.settle();
    const second = await call(`${SHARD}?v=${v}`).res;
    expect(second.status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed version", async () => {
    const r = await call(`${SHARD}?v=not-a-hash`).res;
    expect(r.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("ignores extra query parameters when keying the cache", async () => {
    upstream.mockResolvedValue(new Response(body));
    const v = await sha256Hex(body);
    const first = call(`${SHARD}?v=${v}&x=1`);
    await first.res;
    await first.c.settle();
    await call(`${SHARD}?v=${v}&y=2`).res;
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

describe("unversioned paths", () => {
  it("keeps the legacy shard path for released apps", async () => {
    upstream.mockResolvedValue(new Response("x\n"));
    const r = await call(SHARD).res;
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toContain("max-age=300");
    expect(String(upstream.mock.calls[0][0])).not.toContain("?v=");
  });

  it("serves index.json with no-cache", async () => {
    upstream.mockResolvedValue(new Response("{}"));
    const r = await call("data/index.json").res;
    expect(r.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("still refuses paths outside the allowlist", async () => {
    expect((await call("data/overrides/730.json").res).status).toBe(404);
    expect((await call("data/../secrets").res).status).toBe(404);
  });
});
