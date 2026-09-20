/**
 * `virtual:legal-versions` and `virtual:legal-sources` — what the consent gate
 * needs to say "only the EULA changed, and here is the change".
 *
 * The binding documents are markdown files in the repository (LEGAL_DOCS in
 * src/lib/legal.ts), rendered to HTML at build time by a server-only module.
 * The browser therefore never saw their source, and consent was one integer
 * (`TERMS_VERSION`) that a human had to remember to bump — so every edit meant
 * "read all six again", if it re-prompted at all.
 *
 * Two modules, split by cost:
 *
 *   virtual:legal-versions   A content hash per document. ~700 bytes, imported
 *                            statically, so the gate can decide whether
 *                            anything changed without fetching anything.
 *
 *   virtual:legal-sources    The raw markdown of the six binding documents,
 *                            ~25 KB. Imported DYNAMICALLY (see ConsentGate),
 *                            so Vite gives it its own chunk and a normal page
 *                            load never downloads it. The gate needs it twice:
 *                            to snapshot what was accepted, and to diff the
 *                            next version against that snapshot.
 *
 * Both are inlined in every flavour, the packaged apps included — they run the
 * same gate. Nothing here is secret: /legal/<slug> already publishes the text.
 *
 * Line endings are normalised to LF before hashing and before shipping. A
 * checkout with CRLF (.gitattributes says eol=lf, but a zip download or a
 * mis-set core.autocrlf does not honour it) would otherwise hash differently
 * from CI and re-prompt everyone, and diff as though every line had changed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { CONSENT_DOCS, LEGAL_DOCS, legalDocSlug } from "../src/lib/legal";

const VERSIONS_ID = "virtual:legal-versions";
const SOURCES_ID = "virtual:legal-sources";
const RESOLVED_VERSIONS = `\0${VERSIONS_ID}`;
const RESOLVED_SOURCES = `\0${SOURCES_ID}`;

/**
 * Same resolution as src/lib/server/markdown.ts, and for the same reason: this
 * file is bundled, so a path relative to it resolves against the output
 * directory. `vite build` runs with cwd = web/, so the repo root is its parent.
 */
const REPO_ROOT = join(process.cwd(), "..");

function read(pathInRepo: string): string {
  const full = join(REPO_ROOT, pathInRepo);
  if (!existsSync(full)) {
    throw new Error(
      `legal-versions: ${full} does not exist (cwd=${process.cwd()}). ` +
        "This plugin must run from web/, with the repository checked out above it.",
    );
  }
  return readFileSync(full, "utf-8").replace(/\r\n/g, "\n");
}

/**
 * 16 hex characters of sha256. Not a security boundary — it answers "is this
 * the text you accepted?", where the only adversary is a typo. A full digest
 * would quadruple the size of a map that ships in every page's JavaScript.
 */
function hash(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex").slice(0, 16);
}

function versionsModule(): string {
  const versions: Record<string, string> = {};
  for (const doc of LEGAL_DOCS) versions[legalDocSlug(doc.path)] = hash(read(doc.path));
  return `export const LEGAL_VERSIONS = ${JSON.stringify(versions)};\n`;
}

function sourcesModule(): string {
  const sources: Record<string, string> = {};
  for (const doc of CONSENT_DOCS) sources[legalDocSlug(doc.path)] = read(doc.path);
  return `export const LEGAL_SOURCES = ${JSON.stringify(sources)};\n`;
}

export function legalVersions(): Plugin {
  let versions: string | undefined;
  let sources: string | undefined;

  return {
    name: "f2p-legal-versions",
    resolveId(id) {
      if (id === VERSIONS_ID) return RESOLVED_VERSIONS;
      if (id === SOURCES_ID) return RESOLVED_SOURCES;
      return null;
    },
    load(id) {
      if (id === RESOLVED_VERSIONS) return (versions ??= versionsModule());
      if (id === RESOLVED_SOURCES) return (sources ??= sourcesModule());
      return null;
    },
  };
}
