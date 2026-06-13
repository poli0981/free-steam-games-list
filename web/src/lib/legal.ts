import { REPO_OWNER, REPO_NAME } from "./schema";

/**
 * Single source of truth for the project's legal documents.
 *
 * Lifted out of About.tsx so the first-run consent gate and the About page
 * render the same list. Long-form legal bodies stay in English (markdown in
 * the repo `docs/` folder); only the surrounding UI chrome is translated.
 */
export interface LegalDoc {
  label: string;
  /** Path relative to the repo root, e.g. "docs/EULA.md" or "LICENSE". */
  path: string;
  hint: string;
  /** True for the binding documents shown in the consent gate checkbox flow. */
  consent?: boolean;
}

export const LEGAL_DOCS: LegalDoc[] = [
  { label: "MIT License", path: "LICENSE", hint: "the actual binding terms — short and friendly", consent: true },
  { label: "Disclaimer", path: "docs/DISCLAIMER.md", hint: "no warranty, accuracy caveats, liability shrug", consent: true },
  { label: "Terms of Use", path: "docs/ToS.md", hint: "what you agree to by using the repo / site", consent: true },
  { label: "EULA", path: "docs/EULA.md", hint: "redundant with MIT but exists for paranoia", consent: true },
  { label: "Privacy Policy", path: "docs/PRIVACY_POLICY.md", hint: "no data collected by the site itself", consent: true },
  { label: "Acknowledgements", path: "docs/ACKNOWLEDGEMENTs.md", hint: "credits to AI assistants + contributors" },
  { label: "Contact", path: "docs/Contact.md", hint: "where to find me" },
];

/** The 5 binding documents the user accepts at the consent gate. */
export const CONSENT_DOCS: LegalDoc[] = LEGAL_DOCS.filter((d) => d.consent);

/** Canonical GitHub URL for a legal doc, matching the About page's links. */
export function legalDocUrl(path: string): string {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main/${path}`;
}
