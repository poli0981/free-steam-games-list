/**
 * The two Worker-rendered admin pages.
 *
 * These cannot be exercised by loading them: `/admin` is behind Cloudflare
 * Access, so a local `wrangler dev` answers 404 and there is no way to obtain a
 * valid Access JWT offline. Everything that CAN be checked without a browser is
 * checked here instead — which is more than it sounds, because the pages are
 * one big string and the two ways they break are a template-literal syntax
 * error and an escaping mistake.
 *
 * The syntax case is not hypothetical: the whole document lives inside a
 * TypeScript template literal, so a single backtick in a comment silently ends
 * it, and a literal newline inside a JS string is a parse error the TypeScript
 * compiler cannot see because to it the whole thing is just text.
 */
import { describe, it, expect } from "vitest";
import { adminPage } from "./admin-ui";
import { editPage } from "./edit-ui";

const BACKTICK = String.fromCharCode(96);

async function render(page: (actor: string) => Response, actor = "reviewer@example.com") {
  const res = page(actor);
  return { res, html: await res.text() };
}

/** Pull the inline script out of the rendered page. */
function inlineScript(html: string): string {
  const m = /<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/.exec(html);
  expect(m, "no nonced <script> found in the rendered page").not.toBeNull();
  return m![1];
}

for (const [name, page] of [
  ["admin-ui", adminPage],
  ["edit-ui", editPage],
] as const) {
  describe(name, () => {
    it("renders an HTML document with a nonce CSP", async () => {
      const { res, html } = await render(page);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      // Per-identity and mutable: it must never sit in a cache.
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(html.startsWith("<!doctype html>")).toBe(true);

      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      // 'unsafe-inline' on script-src would defeat the nonce entirely, on the
      // one origin that holds a repository-write credential.
      expect(csp).not.toContain("script-src 'unsafe-inline'");
    });

    it("uses the same nonce in the header and on the script tag", async () => {
      const { res, html } = await render(page);
      const nonce = /'nonce-([a-f0-9]+)'/.exec(res.headers.get("Content-Security-Policy") ?? "")?.[1];
      expect(nonce, "no nonce in the CSP").toBeTruthy();
      expect(html).toContain(`<script nonce="${nonce}">`);
    });

    it("issues a fresh nonce per response", async () => {
      const a = page("a@example.com").headers.get("Content-Security-Policy");
      const b = page("a@example.com").headers.get("Content-Security-Policy");
      expect(a).not.toBe(b);
    });

    it("escapes the actor rather than interpolating it raw", async () => {
      const { html } = await render(page, '"><img src=x onerror=alert(1)>');
      expect(html).not.toContain("<img src=x onerror=alert(1)>");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    // The failure mode this file exists for. A backtick or a literal newline
    // inside a string is invisible to tsc — the page is just text to it — and
    // ships a blank admin screen.
    it("emits an inline script that actually parses", async () => {
      const { html } = await render(page);
      const js = inlineScript(html);
      expect(js.length).toBeGreaterThan(500);
      expect(() => new Function(js)).not.toThrow();
    });

    it("contains no backtick, which would end the outer template literal", async () => {
      const { html } = await render(page);
      expect(html.includes(BACKTICK)).toBe(false);
    });
  });
}

describe("admin-ui specifics", () => {
  it("offers the views that previously had no UI at all", async () => {
    const { html } = await render(adminPage);
    // /api/admin/audit, /api/admin/health and commit_jobs existed as endpoints
    // with no consumer; stats returned commit counts the page discarded.
    for (const label of ["Commit jobs", "Audit log", "Health"]) {
      expect(html).toContain(label);
    }
  });

  it("knows which statuses are decidable", async () => {
    const js = inlineScript((await render(adminPage)).html);
    // Must mirror DECIDABLE in routes/admin.ts. If these drift, the buttons are
    // enabled on tabs where every action returns 409.
    expect(js).toContain('const DECIDABLE = ["pending","deferred","failed"]');
  });

  it("observes an Access redirect instead of following it", async () => {
    const js = inlineScript((await render(adminPage)).html);
    // Following the 302 from fetch() is what produced the
    // cloudflareaccess.com connect-src console error.
    expect(js).toContain('redirect: "manual"');
    expect(js).toContain("SESSION_EXPIRED");
  });

  it("no longer claims every non-JSON response is an expired session", async () => {
    const js = inlineScript((await render(adminPage)).html);
    expect(js).not.toContain("Session expired or Access refused the request");
  });
});

describe("edit-ui specifics", () => {
  it("has a single page-wide busy flag", async () => {
    const js = inlineScript(await editPage("a@b.c").text());
    // There was none: save/saveBulk toggled only the Save button, retire()
    // toggled nothing, so Retire could be double-clicked into two concurrent
    // commits and tab switching stayed live mid-commit.
    expect(js).toContain("function setBusy(");
    expect(js).toContain("if (busy) return;");
  });

  it("warns before discarding an unsaved edit", async () => {
    const js = inlineScript(await editPage("a@b.c").text());
    expect(js).toContain("beforeunload");
  });

  it("clears the other mode's pending state when switching tabs", async () => {
    const js = inlineScript(await editPage("a@b.c").text());
    // One -> Bulk -> One used to leave `dirty` populated while recount()
    // reported bulk.sel.size.
    expect(js).toMatch(/if \(m !== mode\) \{[\s\S]*?dirty = \{\};[\s\S]*?bulk\.sel\.clear\(\);/);
  });

  it("does not report a no-op retire as success", async () => {
    const js = inlineScript(await editPage("a@b.c").text());
    expect(js).toContain("to retire - nothing was committed");
  });
});
