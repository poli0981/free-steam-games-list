/**
 * Cloudflare Worker entry.
 *
 * Only the prefixes listed in wrangler.jsonc's `assets.run_worker_first` reach
 * this code; everything else (the SPA shell, hashed bundles, icons) is served
 * directly by the static-asset server without invoking the Worker at all.
 * The final fallthrough to env.ASSETS.fetch exists for those listed prefixes
 * that turn out not to match a route here.
 */
import { handleData } from "./routes/data";
import { handleImg } from "./routes/img";
import { jsonError } from "./lib/http";
import { verifyAccessJwt } from "./lib/access";
import { handleAdminApi } from "./routes/admin";
import { handleIngestApi } from "./routes/ingest";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith("/api/data/")) {
      return handleData(request, url);
    }

    if (pathname.startsWith("/img/")) {
      return handleImg(request, url, env, ctx);
    }

    // Everything below is admin surface. Authenticate ONCE, here, before any
    // dispatch — not inside each handler, where the next one added is the one
    // that forgets. Cloudflare Access also gates these paths at the edge; this
    // check is what keeps the repo-write credential safe if that policy is
    // ever misconfigured.
    const isAdminApi = pathname.startsWith("/api/admin/");
    const isIngestApi = pathname.startsWith("/api/ingest/");
    const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");

    if (isAdminApi || isIngestApi || isAdminPage) {
      const who = await verifyAccessJwt(request, env);
      if (!who) {
        // The client response is deliberately opaque, which makes this hard to
        // debug from outside — so say what happened in Workers Logs.
        console.warn("admin: access verification failed", {
          path: pathname,
          hasHeader: request.headers.has("Cf-Access-Jwt-Assertion"),
          hasCookie: (request.headers.get("Cookie") ?? "").includes("CF_Authorization"),
        });
        // 404, not 401: an unauthenticated caller learns nothing about what
        // exists here, and Access has already redirected real humans to a
        // login before the request ever arrived.
        return isAdminApi || isIngestApi
          ? jsonError(404, "not found")
          : new Response("Not found", {
              status: 404,
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
              },
            });
      }

      // CSRF. access.ts accepts the JWT from the CF_Authorization cookie, so a
      // cross-origin HTML form POST would carry it and Access would forward the
      // request with the assertion header attached. Same-origin browser
      // requests send Sec-Fetch-Site; non-browser callers (curl, CI) send
      // neither header, and must stay allowed — a curl against these endpoints
      // is the only way to prove the stack works from outside.
      if (request.method !== "GET" && request.method !== "HEAD") {
        const site = request.headers.get("Sec-Fetch-Site");
        const origin = request.headers.get("Origin");
        const browserish = site !== null || origin !== null;
        const sameOrigin = site === "same-origin" || origin === env.SITE_ORIGIN;
        if (browserish && !sameOrigin) {
          console.warn("admin: cross-site request rejected", { path: pathname, site, origin });
          return jsonError(404, "not found");
        }
      }

      if (isIngestApi) return handleIngestApi(request, url, env, who);
      if (isAdminApi) return handleAdminApi(request, url, env, who);

      // The admin UI is not built yet. Answer explicitly rather than falling
      // through to the SPA handler, which would serve the PUBLIC app shell at
      // an admin URL.
      return new Response(`Signed in as ${who.email}. Admin UI not built yet.`, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (pathname.startsWith("/api/")) {
      return jsonError(404, "not found");
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
