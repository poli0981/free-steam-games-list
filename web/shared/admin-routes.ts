/**
 * Every page the admin SPA can render, by exact path, in navigation order.
 *
 * The Worker serves the app shell for exactly these (worker/routes/admin-spa.ts)
 * and 404s everything else under /admin - the old Worker served the queue page
 * for any /admin/* path, so a typo like /admin/edti rendered the queue. The
 * SPA's router holds the same list, and a test keeps the two equal.
 */
export const ADMIN_ROUTES = [
  "/admin",
  "/admin/queue",
  "/admin/automation",
  "/admin/edit",
  "/admin/remove",
  "/admin/quality",
  "/admin/pipeline",
  "/admin/jobs",
  "/admin/audit",
  "/admin/health",
] as const;
export type AdminRoute = (typeof ADMIN_ROUTES)[number];

export function isAdminRoute(path: string): path is AdminRoute {
  return (ADMIN_ROUTES as readonly string[]).includes(path);
}

/** The review queue's own query parameters (views/QueueView.svelte). */
const QUEUE_PARAMS = ["status", "q", "sort", "page", "size"];

/**
 * Until v4.3.0 the queue WAS /admin. A bookmark or a shared link with queue
 * parameters (/admin?status=failed) still lands on the queue, at /admin/queue;
 * a bare /admin is the overview now. null when nothing needs rewriting.
 */
export function legacyQueuePath(pathname: string, search: string): string | null {
  if (pathname !== "/admin") return null;
  const params = new URLSearchParams(search);
  return QUEUE_PARAMS.some((p) => params.has(p)) ? `/admin/queue${search}` : null;
}

/**
 * Where the admin API lives: UNDER /admin, so the Cloudflare Access application
 * that protects the page protects its API too.
 *
 * It used to be /api/admin/*, behind a second Access application. Access issues
 * its session cookie per application, and a fetch() cannot follow Access's
 * sign-in redirect, so a reviewer signed in to /admin held no session for the
 * API at all: every call came back as a redirect to the login page, and the SPA
 * reported "Your Cloudflare Access session has expired" even straight after a
 * fresh sign-in. One application, one cookie, both paths.
 */
export const ADMIN_API_PREFIX = "/admin/api/";
