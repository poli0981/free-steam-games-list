/**
 * Routes that no first-run gate may cover - neither the legal consent gate
 * (common/ConsentGate.svelte) nor the Turnstile human check that follows it
 * (common/HumanCheck.svelte):
 *
 *   - /error/*: a chunk-load 503 after a mid-session deploy, or an
 *     /error/:code deep link, would otherwise be swallowed behind the gate.
 *   - /legal/*: the consent gate links to these documents and asks the reader
 *     to accept them, and the privacy policy is where the human check is
 *     explained. Covering them made the terms impossible to read before
 *     agreeing to them.
 *
 * ANY new route that must be reachable before both gates have been passed has
 * to join this check. One definition, so the two gates cannot disagree.
 */
const UNGATED = /^\/(error|legal)(\/|$)/;

export function isUngatedPath(pathname: string): boolean {
  return UNGATED.test(pathname);
}
