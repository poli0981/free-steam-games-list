/**
 * Compare two strings by UTF-16 code unit: the order a bare `.sort()` gives,
 * written out (SonarCloud typescript:S2871). Not `localeCompare`, on purpose:
 * where this is used - a build id hashed over asset names, the sitemap, an R2
 * listing - the order must not depend on the machine's locale.
 */
export function byCodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
