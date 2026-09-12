import { error } from "@sveltejs/kit";
import { LEGAL_DOCS, legalDocSlug, legalDocUrl } from "$lib/legal";
import { renderRepoMarkdown } from "$lib/server/markdown";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;

/** One prerendered page per document, so /legal/tos is a real static file
 *  rather than something only the SPA fallback can produce. */
export const entries: EntryGenerator = () =>
  LEGAL_DOCS.map((d) => ({ doc: legalDocSlug(d.path) }));

/**
 * +page.server.ts, not +page.ts, and that is the whole design.
 *
 * A server load runs ONLY on the server - here, at build time, because the
 * route is prerendered - and SvelteKit serialises its return value into the
 * page. So the markdown parser and sanitizer never enter the client bundle,
 * there is no runtime {@html} of anything unparsed, and client-side navigation
 * still works because it fetches the serialised data rather than re-running
 * this.
 */
export const load: PageServerLoad = async ({ params }) => {
  // The slug is resolved against the fixed LEGAL_DOCS table BEFORE anything
  // touches the filesystem, so a crafted slug cannot address an arbitrary path
  // in the repository.
  const meta = LEGAL_DOCS.find((d) => legalDocSlug(d.path) === params.doc);
  if (!meta) error(404, "No legal document by that name.");

  // Cross-references between the legal documents resolve to /legal/<slug>
  // rather than sending the reader to GitHub mid-sentence.
  const slugByPath = new Map(LEGAL_DOCS.map((d) => [d.path, legalDocSlug(d.path)]));
  const { html, heading } = renderRepoMarkdown(meta.path, slugByPath);
  return { meta, html, heading, sourceUrl: legalDocUrl(meta.path) };
};
