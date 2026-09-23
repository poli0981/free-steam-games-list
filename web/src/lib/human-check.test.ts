import { describe, expect, it } from "vitest";
import {
  TURNSTILE_SITEKEY,
  humanCheckEnabled,
  isPassValid,
  passRecord,
  replyOutcome,
  siteKeyFor,
  widgetFault,
} from "./human-check";
import { isUngatedPath } from "./gates";
import { HUMAN_CHECK_TTL_SECONDS } from "../../shared/human-check";

/**
 * The human check's decisions. The rule they all follow: refuse only on a
 * verdict from Cloudflare, and let the reader through - for that page load,
 * unrecorded - whenever the fault is this site's.
 */

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("where the check runs", () => {
  it("never in the packaged apps, under npm run dev, or without a site key", () => {
    const sitekey = TURNSTILE_SITEKEY;
    expect(humanCheckEnabled({ tauri: false, dev: false, sitekey })).toBe(true);
    expect(humanCheckEnabled({ tauri: true, dev: false, sitekey })).toBe(false);
    expect(humanCheckEnabled({ tauri: false, dev: true, sitekey })).toBe(false);
    expect(humanCheckEnabled({ tauri: false, dev: false, sitekey: "" })).toBe(false);
  });

  it("uses the real key on the production hostname and the test key everywhere else", () => {
    expect(siteKeyFor("free-steam-games.win")).toBe(TURNSTILE_SITEKEY);
    for (const host of ["localhost", "127.0.0.1", "192.168.1.5", "www.free-steam-games.win.evil.example"]) {
      expect(siteKeyFor(host), host).toBe("1x00000000000000000000AA");
    }
  });

  it("stays out of the way of the legal documents and the error pages", () => {
    for (const path of ["/legal", "/legal/", "/legal/privacy_policy", "/error/503"]) {
      expect(isUngatedPath(path), path).toBe(true);
    }
    for (const path of ["/", "/games", "/games/730", "/legalese", "/errors", "/welcome"]) {
      expect(isUngatedPath(path), path).toBe(false);
    }
  });
});

describe("a stored pass", () => {
  it("counts only while it has not expired", () => {
    expect(isPassValid({ until: NOW + 1000 }, NOW)).toBe(true);
    expect(isPassValid({ until: NOW }, NOW)).toBe(false);
    expect(isPassValid({ until: NOW - 1 }, NOW)).toBe(false);
  });

  it("ignores anything malformed, and a future no pass could have produced", () => {
    for (const stored of [null, undefined, "x", 42, {}, { until: "soon" }, { until: Number.NaN }, { until: Infinity }]) {
      expect(isPassValid(stored, NOW), String(JSON.stringify(stored))).toBe(false);
    }
    expect(isPassValid({ until: NOW + 7 * DAY_MS }, NOW)).toBe(true);
    expect(isPassValid({ until: NOW + 7 * DAY_MS + 1 }, NOW)).toBe(false);
  });

  it("lasts as long as the Worker says, within sane bounds", () => {
    expect(passRecord(HUMAN_CHECK_TTL_SECONDS, NOW)).toEqual({ until: NOW + DAY_MS });
    expect(passRecord(1, NOW)).toEqual({ until: NOW + 60_000 });
    expect(passRecord(10 ** 9, NOW)).toEqual({ until: NOW + 7 * DAY_MS });
    for (const odd of [undefined, null, "86400", Number.NaN]) {
      expect(passRecord(odd, NOW), String(odd)).toEqual({ until: NOW + DAY_MS });
    }
  });

  it("is always one that isPassValid accepts", () => {
    for (const ttl of [60, 3600, HUMAN_CHECK_TTL_SECONDS, 10 ** 9, undefined]) {
      expect(isPassValid(passRecord(ttl, NOW), NOW), String(ttl)).toBe(true);
    }
  });
});

describe("what the Worker's answer means", () => {
  it("passes a verified token", () => {
    expect(replyOutcome(200, { ok: true, ttl: 86400 })).toBe("pass");
  });

  it("refuses only when Cloudflare refused", () => {
    expect(replyOutcome(403, { ok: false, error: "rejected", codes: ["invalid-input-response"] })).toBe("refused");
  });

  it("waves the reader through for anything that is the site's fault", () => {
    expect(replyOutcome(503, { error: "human check not configured" })).toBe("waive");
    expect(replyOutcome(502, { error: "siteverify unreachable" })).toBe("waive");
    expect(replyOutcome(500, null)).toBe("waive");
    // A 403 that is not a verdict - the same-origin guard - is not the reader's doing either.
    expect(replyOutcome(403, { error: "same-origin requests only" })).toBe("waive");
    expect(replyOutcome(200, null)).toBe("waive");
    expect(replyOutcome(415, { error: "expected application/json" })).toBe("waive");
  });
});

describe("what a widget error means", () => {
  it("waves through this site's own misconfiguration", () => {
    for (const code of ["110100", "110110", "110200", "400020", "400070", "102001", "106010"]) {
      expect(widgetFault(code), code).toBe("config");
    }
  });

  it("refuses a failed challenge", () => {
    for (const code of ["300010", "300030", "600010", "600020"]) {
      expect(widgetFault(code), code).toBe("challenge");
    }
  });

  it("offers a retry for everything else", () => {
    for (const code of ["110600", "110620", "200500", "", "unknown"]) {
      expect(widgetFault(code), code).toBe("transient");
    }
  });
});
