import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LIMIT_BINDINGS,
  LIMIT_PERIOD_SECONDS,
  clientKey,
  limitClass,
  rateLimited,
  tooManyRequests,
} from "./rate-limit";

/** A limiter that counts exactly, unlike Cloudflare's, so tests can be exact. */
function fakeLimiter(limit: number) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }: { key: string }) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

const envWith = (bindings: Record<string, unknown>) => bindings as unknown as Env;

const from = (ip: string | null, path = "/api/data/data/index.json") =>
  new Request(`https://free-steam-games.win${path}`, { headers: ip ? { "CF-Connecting-IP": ip } : {} });

/**
 * wrangler.jsonc, comments and trailing commas removed. Comments are only
 * stripped outside strings: the file's URLs carry `//` inside quotes.
 */
function readWranglerConfig(): Record<string, unknown> {
  const text = readFileSync(join(__dirname, "..", "..", "wrangler.jsonc"), "utf8");
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as Record<string, unknown>;
}

describe("limitClass", () => {
  it("gives each surface the Worker serves its own budget", () => {
    expect(limitClass("/api/data/data/index.json")).toBe("data");
    expect(limitClass("/api/data/p1/data_001.bin")).toBe("data");
    expect(limitClass("/img/s/730.jpg")).toBe("img");
    expect(limitClass("/api/human-check")).toBe("human");
    expect(limitClass("/api/activity")).toBe("api");
    expect(limitClass("/api/updates/desktop")).toBe("api");
    expect(limitClass("/api/no-such-route")).toBe("api");
  });

  it("puts the Access-protected surfaces in one generous budget", () => {
    for (const path of ["/admin", "/admin/queue", "/admin/assets/app-1.js", "/admin/api/me", "/api/ingest/known"]) {
      expect(limitClass(path), path).toBe("admin");
    }
  });

  it("covers nothing the Worker never sees", () => {
    expect(limitClass("/")).toBeNull();
    expect(limitClass("/games/730")).toBeNull();
    expect(limitClass("/_app/immutable/entry/start.js")).toBeNull();
    expect(limitClass("/administrator")).toBeNull();
  });

  it("covers every prefix the Worker runs first for", () => {
    // A prefix added to run_worker_first without a budget would be the one
    // surface a flood could reach unlimited.
    const assets = readWranglerConfig().assets as { run_worker_first: string[] };
    for (const prefix of assets.run_worker_first) {
      const sample = prefix.replace(/\*$/, "anything");
      expect(limitClass(sample), prefix).not.toBeNull();
    }
  });
});

describe("clientKey", () => {
  it("is the IPv4 address", () => {
    expect(clientKey(from("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("is the /64 of an IPv6 address, however it is written", () => {
    const key = "2001:db8:a:b::/64";
    expect(clientKey(from("2001:db8:a:b:1:2:3:4"))).toBe(key);
    expect(clientKey(from("2001:0DB8:000A:000B:ffff:0:0:1"))).toBe(key);
    expect(clientKey(from("2001:db8:a:b::1"))).toBe(key);
    expect(clientKey(from("2001:db8::1"))).toBe("2001:db8:0:0::/64");
    expect(clientKey(from("::1"))).toBe("0:0:0:0::/64");
  });

  it("unwraps an IPv4-mapped address instead of filing it under ::/64", () => {
    // Every mapped address shares its first four groups (all zero), so taking
    // the /64 would put every such client on one counter.
    expect(clientKey(from("::FFFF:198.51.100.4"))).toBe("198.51.100.4");
  });

  it("falls back to the raw value for anything it cannot parse", () => {
    expect(clientKey(from("1:2:3"))).toBe("1:2:3");
    expect(clientKey(from("1::2::3"))).toBe("1::2::3");
  });

  it("is null without the header (Vitest, a direct origin request)", () => {
    expect(clientKey(from(null))).toBeNull();
    expect(clientKey(from("  "))).toBeNull();
  });
});

describe("tooManyRequests", () => {
  it("is a 429 that says when to come back and is never cached", async () => {
    const res = tooManyRequests("img");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(LIMIT_PERIOD_SECONDS));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.json()).toEqual({ error: "too many requests" });
  });

  it("answers cross-origin only where the route itself does", () => {
    // The apps fetch /api/data/* and /api/activity from tauri://localhost;
    // without the header they would see a CORS error, not the 429.
    expect(tooManyRequests("data").headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(tooManyRequests("api").headers.get("Access-Control-Allow-Origin")).toBe("*");
    for (const cls of ["img", "human", "admin"] as const) {
      expect(tooManyRequests(cls).headers.get("Access-Control-Allow-Origin"), cls).toBeNull();
    }
  });
});

describe("rateLimited", () => {
  it("lets a client through up to the limit, then refuses it", async () => {
    const env = envWith({ RL_DATA: fakeLimiter(2) });
    expect(await rateLimited(from("203.0.113.7"), "/api/data/x", env)).toBeNull();
    expect(await rateLimited(from("203.0.113.7"), "/api/data/x", env)).toBeNull();
    expect((await rateLimited(from("203.0.113.7"), "/api/data/x", env))?.status).toBe(429);
    // Another address has its own budget.
    expect(await rateLimited(from("203.0.113.8"), "/api/data/x", env)).toBeNull();
  });

  it("charges one IPv6 /64 as one client", async () => {
    const env = envWith({ RL_DATA: fakeLimiter(1) });
    expect(await rateLimited(from("2001:db8:a:b::1"), "/api/data/x", env)).toBeNull();
    expect((await rateLimited(from("2001:db8:a:b::2"), "/api/data/x", env))?.status).toBe(429);
  });

  it("keeps each surface's budget apart", async () => {
    const data = fakeLimiter(1);
    const img = fakeLimiter(1);
    const env = envWith({ RL_DATA: data, RL_IMG: img });
    expect(await rateLimited(from("203.0.113.7"), "/api/data/x", env)).toBeNull();
    expect(await rateLimited(from("203.0.113.7"), "/img/s/730.jpg", env)).toBeNull();
    expect(data.keys).toEqual(["203.0.113.7"]);
    expect(img.keys).toEqual(["203.0.113.7"]);
  });

  it("fails open without a binding, without an address, or when the limiter throws", async () => {
    expect(await rateLimited(from("203.0.113.7"), "/api/data/x", envWith({}))).toBeNull();

    const unused = fakeLimiter(0);
    expect(await rateLimited(from(null), "/api/data/x", envWith({ RL_DATA: unused }))).toBeNull();
    expect(unused.keys).toEqual([]);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = envWith({ RL_DATA: { limit: () => Promise.reject(new Error("binding gone")) } });
    expect(await rateLimited(from("203.0.113.7"), "/api/data/x", broken)).toBeNull();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("does not touch a limiter for a path no class covers", async () => {
    const limiter = fakeLimiter(0);
    const env = envWith(Object.fromEntries(Object.values(LIMIT_BINDINGS).map((b) => [b, limiter])));
    expect(await rateLimited(from("203.0.113.7"), "/games/730", env)).toBeNull();
    expect(limiter.keys).toEqual([]);
  });
});

describe("wrangler.jsonc ratelimits", () => {
  const declared = readWranglerConfig().ratelimits as {
    name: string;
    namespace_id: string;
    simple: { limit: number; period: number };
  }[];

  it("declares exactly the bindings the Worker reads", () => {
    expect(declared.map((r) => r.name).sort()).toEqual(Object.values(LIMIT_BINDINGS).sort());
  });

  it("uses the period Retry-After promises", () => {
    for (const r of declared) expect(r.simple.period, r.name).toBe(LIMIT_PERIOD_SECONDS);
  });

  it("gives each binding its own namespace, or two budgets would share counters", () => {
    const ids = declared.map((r) => r.namespace_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[1-9]\d*$/);
  });

  it("sets limits a person, the apps and the discovery workflow stay well under", () => {
    for (const r of declared) {
      expect(Number.isInteger(r.simple.limit), r.name).toBe(true);
      // A cold catalogue load is ~16 /api/data requests; anything under a few
      // loads a minute would refuse a household behind one address.
      expect(r.simple.limit, r.name).toBeGreaterThanOrEqual(r.name === "RL_HUMAN" ? 10 : 100);
    }
  });
});
