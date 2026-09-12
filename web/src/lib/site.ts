/**
 * Where this app's own API lives.
 *
 * On the web everything is same-origin, so a relative path is correct and also
 * cheaper (no preflight, no second DNS name). The Tauri desktop and Android
 * builds are the exception: they load from tauri://localhost, where a relative
 * URL resolves against the app origin instead of the site, so they need the
 * absolute origin.
 *
 * This used to be copy-pasted into fetcher.ts and image.ts with the same
 * comment in both. Adding a third caller (the Activity proxy) made one shared
 * definition the obviously right shape.
 */
import { isTauri } from "./external-open";

/** Must match `vars.SITE_ORIGIN` in web/wrangler.jsonc. Not exported: nothing
 *  outside this file needs the bare origin, and an unused export is noise. */
const SITE_ORIGIN = "https://free-steam-games.win";

/**
 * Prefix for this site's own absolute paths: "" on the web, the full origin
 * inside a Tauri webview. Concatenate a leading-slash path onto it.
 *
 * Anything reached through this prefix must be served by the Worker with
 * `Access-Control-Allow-Origin: *`, because for the packaged apps it is a
 * cross-origin request.
 */
export const API_ORIGIN = isTauri() ? SITE_ORIGIN : "";
