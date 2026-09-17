/**
 * Steam URL helpers — produce both the `steam://` deep link (opens the
 * Steam desktop client if installed) and the regular https store URL.
 *
 * The web build always renders BOTH buttons because there is no reliable
 * way to detect whether the Steam protocol handler is registered. Users
 * with the desktop client installed get the native flow; users without it
 * fall back to the browser. The packaged apps do NOT allow steam:// by
 * default: tauri-plugin-shell's built-in scope is mailto/tel/http(s) only, so
 * tauri.conf.json widens `plugins.shell.open` to include it.
 */

/** `steam://store/<appid>` — opens the store page in the desktop client. */
export function steamProtocolUrl(appid: string): string {
  return `steam://store/${appid}`;
}

/** Standard https store page. */
export function steamWebUrl(appid: string): string {
  return `https://store.steampowered.com/app/${appid}/`;
}
