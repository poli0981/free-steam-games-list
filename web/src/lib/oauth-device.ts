/**
 * GitHub OAuth Device Flow — alternative to pasting a Classic PAT.
 *
 * Why offer it?
 *   • Visitors don't have to know what a PAT is, where to make one, or what
 *     scopes to tick. They click "Authorize", paste an 8-character code on
 *     github.com, and the app polls until access is granted.
 *   • Safer than handing out a long-lived PAT — Device Flow tokens carry
 *     the scopes the app declared and can be revoked from the user's GitHub
 *     "Authorized OAuth Apps" page.
 *
 * What's needed to actually use this?
 *   1. Register an OAuth App at https://github.com/settings/developers.
 *      • "Application name": F2P Tracker (or anything).
 *      • "Homepage URL": https://poli0981.github.io/free-steam-games-list/
 *      • "Authorization callback URL": same Pages URL (Device Flow doesn't
 *        actually redirect, but the field is required).
 *      • Tick "Enable Device Flow" under the OAuth App settings.
 *   2. Copy the Client ID into `OAUTH_CLIENT_ID` below (or set the env var
 *      VITE_GH_OAUTH_CLIENT_ID at build time so it's not in source).
 *   3. Re-deploy. The Device Flow tab in Settings will light up.
 *
 * Why does the code refuse to start without a CLIENT_ID?
 *   GitHub's Device Flow endpoints all require a client_id. Anonymous calls
 *   return `client_id is required`. Rather than ship broken UI, we surface
 *   "Configure CLIENT_ID first" and link to the docs above.
 *
 * Browser CORS gotcha:
 *   The Device Flow endpoints (`github.com/login/device/code`,
 *   `github.com/login/oauth/access_token`) do not send `Access-Control-
 *   Allow-Origin` for browser callers. So we route through a known CORS
 *   proxy or — preferred — a small fetch helper baked into the desktop
 *   build (Tauri can call them natively). On the web build we fall back to
 *   `https://cors-anywhere.example/...` only if the maintainer wires one
 *   up; otherwise the UI shows "Use the desktop app for OAuth Device Flow"
 *   and links back to PAT input.
 */

export const OAUTH_CLIENT_ID =
  (import.meta.env.VITE_GH_OAUTH_CLIENT_ID as string | undefined) ?? "";

/** Whether the surrounding Authorize-via-Device-Flow UI should render at all. */
export function isOAuthConfigured(): boolean {
  return OAUTH_CLIENT_ID.trim().length > 0;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface AccessTokenResponse {
  access_token: string;
  scope: string;
  token_type: string;
}

/**
 * Browser-friendly wrapper around POST /login/device/code.
 *
 * Tauri builds skip the proxy — `fetch` from a Tauri webview isn't subject
 * to browser CORS, so the call hits github.com directly. Browser-only
 * builds need a CORS proxy; we expose a hook for that via
 * `VITE_GH_OAUTH_PROXY` (no default — leave UI gated until configured).
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  if (!isOAuthConfigured()) {
    throw new Error("CLIENT_ID is not configured for OAuth Device Flow.");
  }
  const url = oauthUrl("/login/device/code");
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: OAUTH_CLIENT_ID, scope: "repo workflow" }),
  });
  if (!res.ok) {
    throw new Error(`device-code: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as DeviceCodeResponse;
}

export interface PollAttempt {
  status: "pending" | "slow_down" | "expired" | "denied" | "ok";
  token?: string;
  intervalSec?: number;
}

export async function pollAccessToken(
  device_code: string,
): Promise<PollAttempt> {
  const res = await fetch(oauthUrl("/login/oauth/access_token"), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: OAUTH_CLIENT_ID,
      device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    interval?: number;
  };
  if (data.access_token) return { status: "ok", token: data.access_token };
  switch (data.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down", intervalSec: data.interval };
    case "expired_token":
      return { status: "expired" };
    case "access_denied":
      return { status: "denied" };
    default:
      throw new Error(`token poll: ${data.error ?? res.status}`);
  }
}

function oauthUrl(path: string): string {
  // Tauri can hit github.com directly; browsers need a CORS proxy.
  const isTauri =
    typeof window !== "undefined" &&
    !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  const proxy = (import.meta.env.VITE_GH_OAUTH_PROXY as string | undefined) ?? "";
  const base = "https://github.com";
  if (isTauri || !proxy) return base + path;
  // proxy is e.g. "https://my-proxy.fly.dev" → result "https://my-proxy.fly.dev/https://github.com/..."
  return proxy.replace(/\/$/, "") + "/" + base + path;
}
