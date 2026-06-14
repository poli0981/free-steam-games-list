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
 *   Allow-Origin` for browser callers. Inside Tauri (desktop AND Android) we
 *   route the request through the native HTTP plugin (`@tauri-apps/plugin-http`,
 *   scoped to github.com in capabilities), which performs it in Rust and
 *   bypasses webview CORS entirely. This matters on Android: unlike desktop,
 *   its System WebView enforces CORS, so a plain `fetch` to github.com/login/*
 *   would be blocked. On the plain web build we fall back to `window.fetch`
 *   plus an optional `VITE_GH_OAUTH_PROXY`; without a proxy the browser will
 *   block the call and the UI points users at the PAT input instead.
 */

import { isTauri } from "./external-open";

export const OAUTH_CLIENT_ID =
  (import.meta.env.VITE_GH_OAUTH_CLIENT_ID as string | undefined) ?? "";

/**
 * `fetch` that bypasses webview CORS when running inside Tauri by going through
 * the native HTTP plugin (Rust/reqwest). On the web build it's the plain
 * `window.fetch`. The plugin export is a drop-in `fetch` with the same shape,
 * lazy-imported so the web bundle never pulls the Tauri module.
 */
async function corsFreeFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}

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
 * Wrapper around POST /login/device/code.
 *
 * Inside Tauri the call goes through the native HTTP plugin (no webview CORS),
 * so it hits github.com directly. Browser-only builds need a CORS proxy via
 * `VITE_GH_OAUTH_PROXY` (no default — leave UI gated until configured).
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  if (!isOAuthConfigured()) {
    throw new Error("CLIENT_ID is not configured for OAuth Device Flow.");
  }
  const url = oauthUrl("/login/device/code");
  const res = await corsFreeFetch(url, {
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
  const res = await corsFreeFetch(oauthUrl("/login/oauth/access_token"), {
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
  // Inside Tauri the request goes through the native HTTP plugin (no CORS), so
  // hit github.com directly. Browsers use a CORS proxy if one is configured.
  const proxy = (import.meta.env.VITE_GH_OAUTH_PROXY as string | undefined) ?? "";
  const base = "https://github.com";
  if (isTauri() || !proxy) return base + path;
  // proxy is e.g. "https://my-proxy.fly.dev" → result "https://my-proxy.fly.dev/https://github.com/..."
  return proxy.replace(/\/$/, "") + "/" + base + path;
}
