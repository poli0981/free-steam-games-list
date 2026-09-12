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
import { handleActivity } from "./routes/activity";
import { jsonError, withSecurityHeaders } from "./lib/http";
import { verifyAccessJwt } from "./lib/access";
import { handleAdminApi } from "./routes/admin";
import { handleIngestApi } from "./routes/ingest";
import { adminPage } from "./routes/admin-ui";
import { editPage } from "./routes/edit-ui";
import { reconcileApproved } from "./lib/reconcile";

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

    // Public, unauthenticated, edge-cached. Placed above the admin block so it
    // is unmistakably outside it: this route must never acquire an Access gate.
    if (pathname === "/api/activity") {
      return handleActivity(request, url, ctx);
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
      // The ingest surface is machine-only and the admin surface is
      // human-only, and they are separate Access applications with separate
      // AUDs. Choosing the AUD set here is what stops either credential
      // reaching the other's routes.
      const who = await verifyAccessJwt(
        request,
        env,
        isIngestApi ? env.ACCESS_AUD_INGEST : env.ACCESS_AUD_ADMIN,
      );
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
        // withSecurityHeaders, not a bare Response: this was the one path in
        // the Worker that shipped no security headers at all, because every
        // other site spreads SECURITY_HEADERS by hand and this one forgot.
        return isAdminApi || isIngestApi
          ? jsonError(404, "not found")
          : withSecurityHeaders(
              new Response("Not found", {
                status: 404,
                headers: {
                  "Content-Type": "text/plain; charset=utf-8",
                  "Cache-Control": "no-store",
                },
              }),
            );
      }

      // Belt and braces on top of the per-route AUD. A service token must
      // never drive the admin surface (it is unattended and cannot be
      // challenged), and a human session must never drive ingest.
      if (isIngestApi !== who.isServiceToken) {
        console.warn("access: wrong credential class for route", {
          path: pathname,
          isServiceToken: who.isServiceToken,
        });
        return jsonError(404, "not found");
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

      // /admin/edit corrects a game already in the catalogue. Same Access gate
      // as the queue; it writes only data/overrides/<appid>.json.
      if (pathname === "/admin/edit") return editPage(who.email);

      // Served from the Worker, never from ASSETS. Falling through to the SPA
      // handler here would serve the PUBLIC app shell at an admin URL.
      return adminPage(who.email);
    }

    if (pathname.startsWith("/api/")) {
      return jsonError(404, "not found");
    }

    return env.ASSETS.fetch(request);
  },

  /**
   * Reconcile approvals against the published dataset.
   *
   * An approval commits only a REQUEST; scripts/ingest_new.py decides whether
   * the game is publishable. Something has to observe that outcome, and it
   * cannot be the approve handler - by the time the pipeline has run, that
   * request finished minutes ago. reconcileApproved() returns immediately when
   * nothing is awaiting publication, so a tick with no work costs one indexed
   * D1 query and no fetches.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      reconcileApproved(env)
        .then((out) => {
          // Log only what is worth reading. reconcileApproved RESOLVES (it does
          // not throw) when GitHub is unreachable, so without this an outage
          // that stops every reconcile would emit nothing at all. The idle skip
          // is excluded because it is the normal state ~96 times a day.
          if (out.skipped && out.skipped !== "nothing approved") {
            console.warn("reconcile skipped", out);
          } else if (out.published || out.removed || out.stale) {
            console.log("reconcile", out);
          }
        })
        .catch((err) => {
          console.error("reconcile failed", err instanceof Error ? err.message : String(err));
        }),
    );
  },
} satisfies ExportedHandler<Env>;
