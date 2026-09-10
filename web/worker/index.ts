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

    // /admin and /api/admin/* are reserved for the Access-gated admin surface.
    // They are already in run_worker_first so that the SPA fallback cannot
    // quietly serve the public shell here; until that surface exists, answer
    // explicitly rather than leaking the public app at an admin URL.
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (pathname.startsWith("/api/")) {
      return jsonError(404, "not found");
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
