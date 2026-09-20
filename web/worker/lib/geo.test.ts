import { describe, expect, it } from "vitest";
import { blockedCountries, isBlockedCountry, requestCountry } from "./geo";

function env(blocked?: string): Env {
  return { BLOCKED_COUNTRIES: blocked } as unknown as Env;
}

/** A request as the edge delivers it: `cf.country`, the header, or neither. */
function req(opts: { cf?: string; header?: string } = {}): Request {
  const r = new Request("https://free-steam-games.win/api/activity", {
    headers: opts.header ? { "CF-IPCountry": opts.header } : {},
  });
  if (opts.cf !== undefined) Object.defineProperty(r, "cf", { value: { country: opts.cf } });
  return r;
}

describe("blockedCountries", () => {
  it("parses the var, ignoring spacing and case", () => {
    expect([...blockedCountries(env(" cn , ru,ar "))]).toEqual(["CN", "RU", "AR"]);
  });

  it("blocks nothing when unset or empty", () => {
    expect(blockedCountries(env()).size).toBe(0);
    expect(blockedCountries(env("")).size).toBe(0);
    expect(blockedCountries(env(" , , ")).size).toBe(0);
  });

  it("drops anything that is not an alpha-2 code", () => {
    expect([...blockedCountries(env("CN,CHINA,R,RU,12"))]).toEqual(["CN", "RU"]);
  });
});

describe("requestCountry", () => {
  it("prefers request.cf over the header", () => {
    expect(requestCountry(req({ cf: "VN", header: "CN" }))).toBe("VN");
  });

  it("falls back to CF-IPCountry", () => {
    expect(requestCountry(req({ header: "ru" }))).toBe("RU");
  });

  it("is null when neither is present", () => {
    expect(requestCountry(req())).toBeNull();
  });

  it("rejects Cloudflare's non-country codes", () => {
    // T1 is Tor, XX is unknown. Neither is a country and neither may match a
    // three-entry blocklist by accident.
    expect(requestCountry(req({ cf: "T1" }))).toBeNull();
    expect(requestCountry(req({ cf: "XX" }))).toBeNull();
  });
});

describe("isBlockedCountry", () => {
  it("blocks a listed country", () => {
    expect(isBlockedCountry(req({ cf: "CN" }), env("CN,RU,AR"))).toBe(true);
    expect(isBlockedCountry(req({ header: "AR" }), env("CN,RU,AR"))).toBe(true);
  });

  it("allows mainland China's neighbours - CN is CN, not HK/MO/TW", () => {
    for (const c of ["HK", "MO", "TW"]) {
      expect(isBlockedCountry(req({ cf: c }), env("CN,RU,AR"))).toBe(false);
    }
  });

  it("FAILS OPEN when the country is unknown", () => {
    // request.cf is undefined under Vitest and under `wrangler dev` without
    // --remote. Failing closed there would 403 every test and every local run.
    expect(isBlockedCountry(req(), env("CN,RU,AR"))).toBe(false);
  });

  it("blocks nothing when the var is unset", () => {
    expect(isBlockedCountry(req({ cf: "CN" }), env())).toBe(false);
  });
});
