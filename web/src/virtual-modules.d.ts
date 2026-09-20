/**
 * Types for modules that exist only inside the Vite build.
 * Implementations: web/build/game-seeds.ts, web/build/legal-versions.ts.
 */
declare module "virtual:game-seeds" {
  import type { GameSeed } from "$lib/game-seed";

  /** Every appid with a prerendered page. Empty in the browser and in Tauri. */
  export function seedAppids(): string[];
  /** The build-time seed for one game, or null. In the browser this reads the
   *  #game-seed block of a prerendered page, so hydration sees the same value
   *  the server rendered with. */
  export function seedFor(appid: string): GameSeed | null;
}

declare module "virtual:legal-versions" {
  /** Content hash per legal-document slug ("eula", "tos", "license", ...),
   *  computed from the repository file at build time. */
  export const LEGAL_VERSIONS: Record<string, string>;
}

declare module "virtual:legal-sources" {
  /** Raw markdown of the six binding documents, by slug. ~25 KB - import this
   *  dynamically only, or it lands in the entry chunk. */
  export const LEGAL_SOURCES: Record<string, string>;
}
