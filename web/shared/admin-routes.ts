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
