/**
 * Serves the admin SPA - ONLY after worker/index.ts has verified the Access
 * identity, the credential class and, for writes, the CSRF checks.
 *
 * The app is built by admin/vite.config.ts and embedded into the Worker bundle
 * (worker/generated/admin-bundle.ts), not placed in dist/. That keeps every
 * byte of it off the public static-asset server, out of the service worker's
 * precache and out of the Tauri apps - the asset server would hand dist/ files
 * to anyone, and run_worker_first is the only thing that would have stood
 * between the public and the admin code.
 *
 *   GET /admin, /admin/edit, /admin/jobs, /admin/audit, /admin/health
 *       -> the shell, with a fresh nonce on its one module script
 *   GET /admin/assets/<exact name>
 *       -> that asset, immutable (the name carries a content hash)
 *   anything else under /admin -> 404
 */
import { SECURITY_HEADERS, jsonError } from "../lib/http";
import { NONCE_PLACEHOLDER, type AdminAsset, type AdminBundle } from "../lib/admin-bundle";
import { isAdminRoute } from "../../shared/admin-routes";

/**
 * Steam serves capsule art from two hosts, and roughly 44% of the catalogue
 * uses the fastly one. Allowlisting only akamai is a mistake this repo has
 * already made once.
 */
const IMG_HOSTS = [
  "https://shared.akamai.steamstatic.com",
  "https://shared.fastly.steamstatic.com",
  "https://cdn.akamai.steamstatic.com",
].join(" ");

/**
 * The shell's Content-Security-Policy.
 *
 * script-src is the nonce alone: the one module script the shell carries is
 * the whole app (the build inlines every dynamic import), so nothing else ever
 * needs to execute. style-src keeps 'unsafe-inline' because Svelte clones
 * templates through innerHTML and a static style="" attribute in one would
 * otherwise be dropped; styles cannot run code, and the previous admin pages
 * had the same allowance. Fonts and images are same-origin assets or Steam
 * artwork; the API is same-origin.
 */
export function adminSpaCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${IMG_HOSTS}`,
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const decoded = new Map<string, Uint8Array>();

function assetBody(path: string, asset: AdminAsset): BodyInit {
  if (asset.encoding === "utf8") return asset.body;
  let bytes = decoded.get(path);
  if (!bytes) {
    const bin = atob(asset.body);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    decoded.set(path, bytes);
  }
  return bytes;
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

export function serveAdmin(request: Request, url: URL, bundle: AdminBundle): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(405, "method not allowed");
  }
  const path = url.pathname;
  const head = request.method === "HEAD";

  if (path === "/admin/") {
    return new Response(null, {
      status: 308,
      headers: { Location: `/admin${url.search}`, "Cache-Control": "no-store", ...SECURITY_HEADERS },
    });
  }

  if (isAdminRoute(path)) {
    // Per response, never cached: a nonce that repeats is not a nonce.
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const html = bundle.shell.replaceAll(NONCE_PLACEHOLDER, nonce);
    return new Response(head ? null : html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": adminSpaCsp(nonce),
        "Cache-Control": "no-store",
        "Cross-Origin-Opener-Policy": "same-origin",
        "X-Admin-Build": bundle.buildId,
        ...SECURITY_HEADERS,
      },
    });
  }

  // Exact keys only: no normalisation, so ".." or a double slash can never
  // name anything but a miss.
  const asset = Object.hasOwn(bundle.assets, path) ? bundle.assets[path] : undefined;
  if (asset) {
    return new Response(head ? null : assetBody(path, asset), {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        // private: these sit behind Access, so no shared cache may keep them.
        "Cache-Control": "private, max-age=31536000, immutable",
        ...SECURITY_HEADERS,
      },
    });
  }

  return notFound();
}
