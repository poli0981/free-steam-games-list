/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/info" />

/**
 * The vite-plugin-pwa references above used to live in src/types/openpgp.d.ts,
 * which had nothing to do with openpgp beyond its filename — deleting that file
 * with the rest of the signing stack silently broke the types for
 * `virtual:pwa-register/react`. They belong here.
 */

/** App version injected from package.json at build time (see vite.config.ts). */
declare const __APP_VERSION__: string;
