/**
 * Source text for the tests that scan the code base (i18n, SEO, charts), with
 * comments removed so prose about a pattern is not mistaken for a use of it.
 *
 * One scanner instead of the three regexes those tests carried. CodeQL read a
 * regex replace of "<!--" as an HTML sanitiser and flagged it as incomplete,
 * which does not apply to a test reading its own source; the fix for that in
 * one of them (replace until nothing changes) was worse, because a second pass
 * removes text that was never inside a comment. This removes each span once,
 * left to right, and never looks at its own output.
 */

/** `text` without every `open`...`close` span. An opener with no closer is left
 *  in place, as the regexes this replaced left it. */
export function stripSpans(text: string, open: string, close: string): string {
  let out = "";
  let cursor = 0;
  for (let at = text.indexOf(open); at !== -1; at = text.indexOf(open, cursor)) {
    const end = text.indexOf(close, at + open.length);
    if (end === -1) break;
    out += text.slice(cursor, at);
    cursor = end + close.length;
  }
  return out + text.slice(cursor);
}

/** HTML comments, then block comments. Line comments are left to the caller:
 *  "//" is also in every https:// URL, and each test draws that line itself. */
export function withoutBlockComments(text: string): string {
  return stripSpans(stripSpans(text, "<!--", "-->"), "/*", "*/");
}
