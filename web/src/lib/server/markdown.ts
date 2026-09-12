/**
 * Markdown -> HTML, at BUILD TIME only.
 *
 * This settles the open question the plan carried: which markdown sanitizer to
 * use for in-app `/legal/*`. The answer is that none of it ships.
 *
 * Every one of these routes is prerendered, so this module runs in Node during
 * `vite build` and its output is baked into static HTML. No parser, no
 * sanitizer and no `{@html}` of untrusted input reaches the browser, which
 * means there is no runtime XSS surface to reason about and no CSP change is
 * needed. The `src/lib/server/` location is enforced by SvelteKit: importing
 * it from client code is a build error, not a convention.
 *
 * rehype-sanitize is still applied, even though `docs/*.md` is repository
 * content written by the maintainer. It costs nothing at build time, and the
 * alternative is a build that silently starts emitting whatever a future
 * contributor puts in a legal document.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";

/**
 * The repository root, from the build's working directory.
 *
 * NOT derived from import.meta.url. This module gets bundled into
 * .svelte-kit/output/server/index.js, so a path relative to the source file
 * resolves against the OUTPUT directory instead and every read fails with
 * ENOENT - which is exactly what happened the first time. `vite build` runs
 * with cwd = web/, so the root is its parent.
 */
const REPO_ROOT = join(process.cwd(), "..");

// Fail loudly and once, with the resolved path, rather than ENOENT per file.
if (!existsSync(join(REPO_ROOT, "LICENSE"))) {
  throw new Error(
    `renderRepoMarkdown: repository root not found at ${REPO_ROOT} ` +
      `(cwd=${process.cwd()}). This module must be run from web/.`,
  );
}

/**
 * Rewrite the relative links inside a repository document.
 *
 * The markdown is written for GitHub, so it is full of hrefs like
 * `../CONTRIBUTING.md`, `docs/ToS.md` and `LICENSE`. Rendered as-is on the
 * site those resolve to site paths that do not exist - and SvelteKit's
 * prerenderer follows every same-origin link, so the build fails with
 * `404 /SECURITY.md` rather than shipping a quietly broken page.
 *
 * A document that has its own /legal/ route links there; everything else goes
 * to GitHub, which is where the file actually lives.
 */
function rewriteLinks(root: unknown, slugByPath: Map<string, string>): void {
  const node = root as { tagName?: string; properties?: Record<string, unknown>; children?: unknown[] };

  if (node.tagName === "a" && typeof node.properties?.href === "string") {
    const href = node.properties.href;
    // Leave absolute URLs, in-page anchors and mailto: alone.
    if (!/^([a-z]+:|\/\/|#)/i.test(href)) {
      // Normalise "./x", "../x" and "docs/x" to a repo-root-relative path.
      const clean = href.replace(/^(\.\/|\.\.\/)+/, "").split(/[?#]/)[0];
      const slug = slugByPath.get(clean) ?? slugByPath.get("docs/" + clean);
      node.properties.href = slug
        ? "/legal/" + slug
        : "https://github.com/" + REPO + "/blob/main/" + clean;
    }
  }

  for (const child of node.children ?? []) rewriteLinks(child, slugByPath);
}

const REPO = "poli0981/free-steam-games-list";

const processor = unified()
  .use(remarkParse)
  // The legal documents use tables and strikethrough.
  .use(remarkGfm)
  // allowDangerousHtml is NOT set: raw HTML in a source document is dropped
  // rather than passed to the sanitizer to argue with.
  .use(remarkRehype)
  .use(rehypeSanitize, {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      // rehype-slug adds these, and the sanitizer would strip them, which
      // would break every in-page anchor in a long document.
      "*": [...(defaultSchema.attributes?.["*"] ?? []), "id"],
    },
  })
  .use(rehypeSlug)
  .use(rehypeStringify);

export interface RenderedDoc {
  html: string;
  /** First H1, used as the page title when the document has one. */
  heading: string | null;
}

/**
 * Render one repository markdown file.
 *
 * `pathInRepo` is trusted: it comes from the fixed LEGAL_DOCS table, never from
 * a URL. The route resolves a slug to an entry in that table first and 404s if
 * it does not match, so no user input reaches this path.
 */
export function renderRepoMarkdown(
  pathInRepo: string,
  /** repo path -> /legal slug, so cross-references between the documents stay
   *  inside the app instead of bouncing the reader to GitHub. */
  slugByPath: Map<string, string> = new Map(),
): RenderedDoc {
  const raw = readFileSync(join(REPO_ROOT, pathInRepo), "utf8");
  const tree = processor.runSync(processor.parse(raw));
  rewriteLinks(tree, slugByPath);
  const html = processor.stringify(tree as never);
  const heading = /^#\s+(.+)$/m.exec(raw)?.[1]?.trim() ?? null;
  return { html, heading };
}
