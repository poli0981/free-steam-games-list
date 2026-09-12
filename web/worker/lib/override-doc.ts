/**
 * Serialisation of `data/overrides/<appid>.json`, in one place.
 *
 * The bytes matter. `scripts/edit_game.py` (CLI) and `routes/edit.ts` (the
 * /admin/edit screen) both write these files, and if their formatting differs
 * by so much as a trailing newline then every edit that alternates between the
 * two tools produces a whole-file diff instead of a one-line one.
 *
 * `docs/ADMIN.md` claimed this equality was "asserted by a parity test". It was
 * not — there were no tests in this repository at all. There is one now
 * (`override-doc.test.ts`), and it works by round-tripping the real
 * Python-written files in `data/overrides/` through this function and asserting
 * the bytes come back identical.
 *
 * Matching `json.dump(doc, ensure_ascii=False, indent=2, sort_keys=False)`
 * followed by a newline:
 *   - indent 2, and `": "` / `",\n"` separators — same as JSON.stringify's
 *   - `ensure_ascii=False` emits raw UTF-8, and JSON.stringify escapes only
 *     control characters and quotes, so non-ASCII game names agree
 *   - `sort_keys=False` keeps insertion order, so CALLERS must build the keys
 *     in the same order Python does. That is the fragile part, and what the
 *     round-trip test actually pins down.
 */
export function serialiseOverride(doc: unknown): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
