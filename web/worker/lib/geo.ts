/**
 * Country-based refusal, as defence in depth — NOT as the boundary.
 *
 * The boundary is a WAF custom rule on the zone
 * (`ip.geoip.country in {"CN" "RU" "AR"}` → Block, see docs/SECURITY_SETUP.md).
 * It has to be, because the public HTML never invokes this Worker at all:
 * wrangler.jsonc's `assets.run_worker_first` lists only `/api/*`, `/img/*`,
 * `/admin` and `/admin/*`, so a visitor could read every prerendered page with
 * this module in place and the WAF rule absent. What this adds is that the
 * data, image, activity, updater and admin surfaces stay closed if that rule is
 * ever deleted, mistyped or scoped to the wrong hostname — and that the list
 * lives in the repository where a change to it is reviewable.
 *
 * FAIL OPEN when the country is unknown. `request.cf` is undefined under
 * Vitest and under `wrangler dev` without `--remote`, and the CF-IPCountry
 * header is absent on a direct origin request; failing closed there would mean
 * every Worker test and every local run answered 403. The WAF rule runs before
 * any of that and does not share the weakness.
 */

/**
 * Cloudflare's two non-countries. "T1" is a Tor exit and "XX" is "we could not
 * geolocate this address" - XX has the SHAPE of a country code, so without
 * naming it here a blocklist containing "XX" would silently refuse every
 * visitor the edge failed to place, which is the opposite of failing open.
 */
const NOT_A_COUNTRY = new Set(["T1", "XX"]);

/** ISO 3166-1 alpha-2, uppercase, or null when it is unknown or not a country. */
export function requestCountry(request: Request): string | null {
  const cf = (request as { cf?: { country?: unknown } }).cf;
  const fromCf = typeof cf?.country === "string" ? cf.country : null;
  const raw = fromCf ?? request.headers.get("CF-IPCountry");
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.has(code)) return null;
  return code;
}

/**
 * Parse BLOCKED_COUNTRIES ("CN,RU,AR"). Tolerant of spacing, case and empty
 * entries so the var can be edited by hand without breaking the Worker; an
 * unset or empty var blocks nothing, which is what a fresh checkout wants.
 *
 * Read through a cast rather than declared in worker/env.d.ts. Env there merges
 * with the generated worker-configuration.d.ts, where `wrangler types` writes
 * each var as its LITERAL value ("CN,RU,AR"); a hand-written `string` or
 * `string | undefined` for the same key makes that merge a type error the next
 * time anyone regenerates it.
 */
export function blockedCountries(env: Env): Set<string> {
  const raw = (env as { BLOCKED_COUNTRIES?: string }).BLOCKED_COUNTRIES ?? "";
  return new Set(
    raw
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c)),
  );
}

export function isBlockedCountry(request: Request, env: Env): boolean {
  const blocked = blockedCountries(env);
  if (!blocked.size) return false;
  const country = requestCountry(request);
  return country !== null && blocked.has(country);
}
