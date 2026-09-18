/**
 * Every page the admin SPA can render, by exact path.
 *
 * The Worker serves the app shell for exactly these (worker/routes/admin-spa.ts)
 * and 404s everything else under /admin - the old Worker served the queue page
 * for any /admin/* path, so a typo like /admin/edti rendered the queue. The
 * SPA's router holds the same list, and a test keeps the two equal.
 */
export const ADMIN_ROUTES = ["/admin", "/admin/edit", "/admin/jobs", "/admin/audit", "/admin/health"] as const;
export type AdminRoute = (typeof ADMIN_ROUTES)[number];

export function isAdminRoute(path: string): path is AdminRoute {
  return (ADMIN_ROUTES as readonly string[]).includes(path);
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
