/**
 * Legal consent: whether these terms were accepted, and which VERSION of them.
 *
 * Split out of prefs.svelte.ts because it imports `virtual:legal-versions`,
 * which only the public app's Vite config provides - prefs.svelte.ts is also
 * compiled by the admin SPA's own build, where that module does not exist.
 *
 * The shape of the problem this solves: a legal document used to change and
 * nothing happened, unless a human remembered to bump TERMS_VERSION, at which
 * point everyone was asked to read all six documents again from the top. Now
 * each document carries a content hash computed at build time, the gate
 * re-opens by itself when one of them differs from what was accepted, and it
 * shows only those documents, as a diff against the accepted text.
 */
import { LEGAL_VERSIONS } from "virtual:legal-versions";
import { CONSENT_DOCS, legalDocSlug } from "./legal";
import { readJson, writeJson } from "./prefs.svelte";

const CONSENT_KEY = "f2p:legal_consent";
/** The accepted TEXT, kept apart from the acceptance itself: ~25 KB, and a
 *  storage quota refusal here must not cost someone their consent. */
const SNAPSHOT_KEY = "f2p:legal_snapshot";

/**
 * The "make everyone read all six documents again" lever, and nothing else.
 *
 * Routine edits no longer need it. Each document carries a content hash
 * (virtual:legal-versions, built by build/legal-versions.ts) and a changed hash
 * re-prompts by itself, showing only what changed - which is the point, and
 * which bumping this number would defeat. Bump it only when the relationship
 * between the reader and the documents has changed so much that a diff would
 * misrepresent it.
 *
 * 3 (Sept 2026): the licence split, plus a Privacy Policy that now discloses
 * edge logging where the previous one claimed there was no server at all.
 */
export const TERMS_VERSION = 3;

interface StoredConsent {
  version: number;
  /** ISO timestamp of acceptance - informational only. */
  acceptedAt: string;
  /**
   * Content hash per document slug, as of acceptance. Absent for anyone who
   * accepted before this existed; that record is honoured as an acceptance of
   * the CURRENT documents rather than re-prompting the whole audience once for
   * nothing - see hydrate().
   */
  docs?: Record<string, string>;
}

/** What the reader accepted, so the next version can be shown as a diff. */
type StoredSnapshot = Record<string, string>;

/** Slugs whose text differs from the copy that was accepted. */
function changedSlugs(stored: Record<string, string> | undefined): string[] {
  if (!stored) return [];
  return CONSENT_DOCS.map((d) => legalDocSlug(d.path)).filter(
    (slug) => LEGAL_VERSIONS[slug] !== undefined && stored[slug] !== undefined && stored[slug] !== LEGAL_VERSIONS[slug],
  );
}

class Consent {
  accepted = $state(false);
  /**
   * False until storage has been read.
   *
   * The gate opens only once this is true. Before it existed the gate rendered
   * whenever `accepted` was false - which it always is during prerender - so
   * EVERY prerendered page shipped the full consent dialog in its HTML, and a
   * returning visitor who had long since accepted saw it flash on each full
   * page load until hydration hid it again.
   */
  hydrated = $state(false);

  /**
   * Documents that changed since they were accepted.
   *
   * Non-empty means the gate opens in its REVIEW form: those documents only,
   * each as a diff against the accepted text. Empty with `accepted` false is a
   * first visit, and the gate asks for all six.
   */
  changed = $state<string[]>([]);

  /** The text that was accepted, by slug. Missing entries are not an error -
   *  the gate offers the full document instead of a diff for those. */
  #snapshot: StoredSnapshot = {};

  /** Read from storage. Called once the app is mounted, never during
   *  prerender, where there is no localStorage. */
  hydrate(): void {
    const stored = readJson<StoredConsent>(CONSENT_KEY);
    this.#snapshot = readJson<StoredSnapshot>(SNAPSHOT_KEY) ?? {};

    if (stored?.version !== TERMS_VERSION) {
      this.accepted = false;
      this.changed = [];
      this.hydrated = true;
      return;
    }

    // A record from before per-document hashing has no `docs` map. Treat it as
    // current rather than re-prompting everyone once for nothing: the first
    // acceptance after this ships writes the map, and every later edit is a
    // diff. There is nothing to diff against for that one transition anyway.
    this.changed = changedSlugs(stored.docs);
    this.accepted = this.changed.length === 0;
    if (!stored.docs) this.#writeConsent();
    this.hydrated = true;
  }

  /** The text of a changed document as it was accepted, or null when no
   *  snapshot survived (storage was cleared, or it predates this feature). */
  acceptedText(slug: string): string | null {
    return this.#snapshot[slug] ?? null;
  }

  /**
   * @param sources current text by slug, from `virtual:legal-sources`. Omitted
   * when that dynamic import failed: the acceptance still stands, and the next
   * change falls back to "read it in full".
   */
  accept(sources?: Record<string, string>): void {
    this.#writeConsent();
    if (sources) {
      this.#snapshot = { ...this.#snapshot, ...sources };
      writeJson(SNAPSHOT_KEY, this.#snapshot);
    }
    this.changed = [];
    this.accepted = true;
  }

  #writeConsent(): void {
    writeJson(CONSENT_KEY, {
      version: TERMS_VERSION,
      acceptedAt: new Date().toISOString(),
      docs: Object.fromEntries(
        CONSENT_DOCS.map((d) => legalDocSlug(d.path)).map((slug) => [slug, LEGAL_VERSIONS[slug] ?? ""]),
      ),
    } satisfies StoredConsent);
  }
}

export const consent = new Consent();
