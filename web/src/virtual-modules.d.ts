/**
 * Types for modules that exist only inside the Vite build.
 * Implementations: web/build/game-seeds.ts.
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
