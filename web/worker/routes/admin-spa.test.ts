import { describe, expect, it } from "vitest";
import { adminSpaCsp, serveAdmin } from "./admin-spa";
import type { AdminBundle } from "../lib/admin-bundle";
import { ADMIN_ROUTES } from "../../shared/admin-routes";

const bundle: AdminBundle = {
  buildId: "test-build",
  shell:
    '<!doctype html><html><head><link rel="stylesheet" href="/admin/assets/app-1.css"></head>' +
    '<body><div id="app"></div><script type="module" nonce="__ADMIN_NONCE__" src="/admin/assets/app-1.js"></script></body></html>',
  assets: {
    "/admin/assets/app-1.js": { contentType: "text/javascript; charset=utf-8", encoding: "utf8", body: "console.log(1)" },
    "/admin/assets/app-1.css": { contentType: "text/css; charset=utf-8", encoding: "utf8", body: "body{}" },
    "/admin/assets/font-1.woff2": { contentType: "font/woff2", encoding: "base64", body: btoa("wOF2") },
  },
};

function get(path: string, method = "GET") {
  const url = new URL(`https://free-steam-games.win${path}`);
  return serveAdmin(new Request(url, { method }), url, bundle);
}

describe("the admin shell", () => {
  it.each(ADMIN_ROUTES.map((r) => [r]))("serves %s", async (route) => {
    const res = get(route);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("puts a fresh nonce on the script, and the same one in the CSP", async () => {
    const a = get("/admin");
    const b = get("/admin");
    const nonceOf = async (res: Response) => /nonce="([a-f0-9]{32})"/.exec(await res.text())?.[1];
    const na = await nonceOf(a);
    expect(na).toBeTruthy();
    expect(a.headers.get("Content-Security-Policy")).toContain(`'nonce-${na}'`);
    expect(await nonceOf(b)).not.toBe(na);
  });

  it("has a CSP that allows no inline or foreign script", () => {
    const csp = adminSpaCsp("abc");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'nonce-abc'(;|$)/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("redirects the trailing slash, keeping the query", () => {
    const res = get("/admin/?status=failed");
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("/admin?status=failed");
  });
});

describe("assets and everything else", () => {
  it("serves exact asset paths immutably and privately", async () => {
    const js = get("/admin/assets/app-1.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(await js.text()).toBe("console.log(1)");

    const font = get("/admin/assets/font-1.woff2");
    expect(new TextDecoder().decode(await font.arrayBuffer())).toBe("wOF2");
  });

  it("404s unknown admin paths instead of serving the queue", () => {
    // ("/admin/assets/../assets/app-1.js" is not here: the URL parser
    // normalises it to the real asset path before the Worker ever sees it.)
    for (const path of ["/admin/edti", "/admin/assets/", "/admin//assets/app-1.js", "/admin/assets/nope.js", "/admin/assets/__proto__"]) {
      expect(get(path).status, path).toBe(404);
    }
  });

  it("answers HEAD without a body and refuses writes", async () => {
    const head = get("/admin", "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(get("/admin", "POST").status).toBe(405);
  });
});
