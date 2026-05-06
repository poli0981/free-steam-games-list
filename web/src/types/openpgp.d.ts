/**
 * The openpgp npm package ships its own .d.ts; this file is intentionally
 * left almost empty so we don't shadow them.
 *
 * The local `web/src/gpgauth/openpgp.min.mjs` file is kept for reference but
 * isn't imported — it splits into chunks (noble_curves, etc.) that weren't
 * copied alongside, so we use the npm package which bundles everything.
 */
export {};
