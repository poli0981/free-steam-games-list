/**
 * `virtual:game-seeds` - the data behind the prerendered /games/[appid] pages.
 *
 * One module id, three implementations, chosen per build:
 *
 *   SERVER (the SSR build SvelteKit prerenders with)
 *     Reads ../data/index.json and every shard it names, once, and inlines a
 *     seed per game. `seedAppids()` feeds the route's `entries`, `seedFor()`
 *     its load. This build is only ever run by the prerenderer - it is never
 *     deployed - so the several megabytes it inlines ship nowhere.
 *
 *   CLIENT
 *     `seedAppids()` is empty, and `seedFor(appid)` reads the seed back out of
 *     the #game-seed block the prerendered page carries (game-seed.ts). The
 *     route's load runs again in the browser during hydration, and returning
 *     anything else there would mismatch the server-rendered markup.
 *
 *   TESTS / TAURI / F2P_SKIP_GAME_PRERENDER=1
 *     A tiny fixture under Vitest; nothing at all for the packaged apps, which
 *     must not ship 3,650 HTML files and resolve game pages through the SPA
 *     fallback instead. The skip variable exists for quick local builds.
 *
 * A missing data directory FAILS the build rather than silently producing zero
 * pages. Workers Builds uses `web` as its root directory but checks out the
 * whole repository, so ../data is always there in a real deploy.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { toSeed, SEED_ELEMENT_ID, type GameSeed } from "../src/lib/game-seed";

const VIRTUAL_ID = "virtual:game-seeds";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

const CLIENT_MODULE = `
export function seedAppids() {
  return [];
}
export function seedFor(appid) {
  if (typeof document === "undefined") return null;
  const el = document.getElementById(${JSON.stringify(SEED_ELEMENT_ID)});
  if (!el || el.getAttribute("data-appid") !== appid) return null;
  try {
    return JSON.parse(el.textContent || "null");
  } catch {
    return null;
  }
}
`;

function serverModule(seeds: Record<string, GameSeed>): string {
  return `
const SEEDS = new Map(Object.entries(${JSON.stringify(seeds)}));
export function seedAppids() {
  return [...SEEDS.keys()];
}
export function seedFor(appid) {
  return SEEDS.get(appid) ?? null;
}
`;
}

const FIXTURE: Record<string, GameSeed> = Object.fromEntries(
  [
    { link: "https://store.steampowered.com/app/730/", name: "Counter-Strike 2", genre: "FPS" },
    { link: "https://store.steampowered.com/app/570/", name: "Dota 2", genre: "MOBA" },
  ].map((r) => {
    const seed = toSeed(r)!;
    return [seed.appid, seed];
  }),
);

function readSeeds(dataDir: string): Record<string, GameSeed> {
  const indexPath = join(dataDir, "index.json");
  if (!existsSync(indexPath)) {
    throw new Error(
      `game-seeds: ${indexPath} does not exist. Game pages are prerendered from data/ ` +
        "at build time; set F2P_SKIP_GAME_PRERENDER=1 to build without them.",
    );
  }
  const index = JSON.parse(readFileSync(indexPath, "utf-8")) as { files: { name: string }[] };
  const seeds: Record<string, GameSeed> = {};
  for (const file of index.files) {
    const text = readFileSync(join(dataDir, file.name), "utf-8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const seed = toSeed(JSON.parse(line) as Record<string, unknown>);
        if (seed) seeds[seed.appid] = seed;
      } catch {
        // One malformed line must not cost the build every other page.
      }
    }
  }
  if (Object.keys(seeds).length === 0) {
    throw new Error(`game-seeds: no records found under ${dataDir}`);
  }
  return seeds;
}

export function gameSeeds(options: { enabled: boolean; dataDir: string }): Plugin {
  let seeds: Record<string, GameSeed> | undefined;

  return {
    name: "f2p-game-seeds",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id, loadOptions) {
      if (id !== RESOLVED_ID) return null;
      const env = (this as { environment?: { config?: { consumer?: string } } }).environment;
      const server = env?.config?.consumer ? env.config.consumer === "server" : Boolean(loadOptions?.ssr);
      if (!server) return CLIENT_MODULE;
      if (process.env.VITEST) return serverModule(FIXTURE);
      if (!options.enabled) return serverModule({});
      seeds ??= readSeeds(options.dataDir);
      return serverModule(seeds);
    },
  };
}
