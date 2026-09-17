import { REPO_OWNER, REPO_NAME } from "./schema";

/**
 * Single source of truth for the project's legal documents.
 *
 * Lifted out of About.tsx so the first-run consent gate and the About page
 * render the same list. Long-form legal bodies stay in English (markdown in
 * the repo `docs/` folder); only the surrounding UI chrome is translated.
 */
export interface LegalDoc {
  /** i18n key: render with t(). The document title as the lists show it. */
  label: string;
  /** Path relative to the repo root, e.g. "docs/EULA.md" or "LICENSE". */
  path: string;
  /** i18n key: a one-line summary of what the document covers. */
  hint: string;
  /** True for the binding documents shown in the consent gate checkbox flow. */
  consent?: boolean;
}

/**
 * Literal keys, so i18n.test.ts can check every one exists. These used to be
 * English strings, which is why a Vietnamese reader saw the whole consent list,
 * the About page's legal section and every document title in English.
 */
export const LEGAL_DOCS: LegalDoc[] = [
  { label: "legal.docs.license.label", path: "LICENSE", hint: "legal.docs.license.hint", consent: true },
  { label: "legal.docs.licenseData.label", path: "LICENSE-DATA", hint: "legal.docs.licenseData.hint", consent: true },
  { label: "legal.docs.disclaimer.label", path: "docs/DISCLAIMER.md", hint: "legal.docs.disclaimer.hint", consent: true },
  { label: "legal.docs.tos.label", path: "docs/ToS.md", hint: "legal.docs.tos.hint", consent: true },
  { label: "legal.docs.eula.label", path: "docs/EULA.md", hint: "legal.docs.eula.hint", consent: true },
  { label: "legal.docs.privacy.label", path: "docs/PRIVACY_POLICY.md", hint: "legal.docs.privacy.hint", consent: true },
  { label: "legal.docs.acknowledgements.label", path: "docs/ACKNOWLEDGEMENTs.md", hint: "legal.docs.acknowledgements.hint" },
  { label: "legal.docs.contact.label", path: "docs/Contact.md", hint: "legal.docs.contact.hint" },
];

/** The binding documents the user accepts at the consent gate - six of them,
 *  not the five this comment claimed since the licence split added
 *  LICENSE-DATA. Derived from the flag rather than counted by hand. */
export const CONSENT_DOCS: LegalDoc[] = LEGAL_DOCS.filter((d) => d.consent);

/**
 * The in-app route for a doc: "docs/ToS.md" -> "/legal/tos".
 *
 * These routes exist now. Welcome.tsx used to build this exact string and then
 * call e.preventDefault() on the click, redirecting to /about, because nothing
 * was there to receive it.
 */
export function legalDocSlug(path: string): string {
  return path
    .replace(/^docs\//, "")
    .replace(/\.md$/, "")
    .toLowerCase();
}

/** Canonical GitHub URL for a legal doc, matching the About page's links. */
export function legalDocUrl(path: string): string {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main/${path}`;
}

/** Whether a /legal/<slug> names a document. The route's param matcher
 *  (src/params/legaldoc.ts), so an unknown slug matches no route at all and
 *  renders the layout's translated 404 instead of the dashboard. */
export function isLegalDocSlug(slug: string): boolean {
  return LEGAL_DOCS.some((d) => legalDocSlug(d.path) === slug);
}
