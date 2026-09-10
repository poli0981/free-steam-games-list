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
    const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");

    if (isAdminApi || isAdminPage) {
      const who = await verifyAccessJwt(request, env);
      if (!who) {
        // 404, not 401: an unauthenticated caller learns nothing about what
        // exists here, and Access has already redirected real humans to a
        // login before the request ever arrived.
        return isAdminApi
          ? jsonError(404, "not found")
          : new Response("Not found", {
              status: 404,
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
              },
            });
      }

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
