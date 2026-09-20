/**
 * Cloudflare Web Analytics, loaded by the app rather than injected by the edge.
 *
 * WHY NOT THE AUTOMATIC SETUP. Cloudflare's "automatic" Web Analytics rewrites
 * HTML responses at the edge, after our origin response, and inserts the beacon
 * tag PLUS an inline loader script. `kit.csp` runs in `mode: "hash"`, and CSP3
 * says a script-src carrying a hash or nonce IGNORES 'unsafe-inline' — so there
 * is no policy we could write that admits that inline script. It had been
 * enabled on the zone for months, logging two CSP violations per page load and
 * collecting exactly nothing (docs/SECURITY_SETUP.md §9). The dashboard must
 * stay on "Enable with JS Snippet installation" for this module to be the only
 * thing loading the beacon; turning automatic injection back on re-creates
 * those console errors without adding any data.
 *
 * WHY AFTER CONSENT. The consent gate already holds back the catalogue fetch
 * and the service worker; the privacy policy says nothing reaches a third party
 * until you accept, and that stays literally true. It undercounts people who
 * never accept, which is the intended trade.
 *
 * WHY NOT IN THE PACKAGED APPS. The beacon measures a website. Under Tauri the
 * page origin is tauri://localhost and the CSP (both the meta policy and the
 * header from tauri.conf.json) has no room for the host — the request would be
 * blocked, not silently ignored.
 */
import { isTauri } from "./external-open";

/**
 * The Web Analytics site tag. NOT a secret: Cloudflare's own snippet publishes
 * it in the page's HTML, and it only identifies which site a beacon belongs to.
 * From Analytics & Logs → Web Analytics → Manage site → JS snippet.
 *
 * Empty disables analytics entirely, which is what a fork or a local build
 * wants, and what `npm run dev` gets.
 */
export const CF_BEACON_TOKEN = "4219edc26f404519a689e11b76b103d2";

const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

let loaded = false;

/**
 * Append the beacon once. Safe to call repeatedly — the consent effect can
 * re-run, and a second <script> would double every page view.
 */
export function loadAnalytics(): void {
  if (loaded || typeof document === "undefined") return;
  if (!CF_BEACON_TOKEN || isTauri()) return;
  loaded = true;

  const el = document.createElement("script");
  // type="module", matching the snippet Cloudflare's dashboard hands out. A
  // module script defers by default, so there is no `defer` to set as well.
  el.type = "module";
  el.src = BEACON_SRC;
  // The attribute name and JSON shape are Cloudflare's, copied from the
  // dashboard's snippet. Token only: every other key it accepts is a default
  // we have no reason to change.
  el.setAttribute("data-cf-beacon", JSON.stringify({ token: CF_BEACON_TOKEN }));
  document.head.appendChild(el);
}
