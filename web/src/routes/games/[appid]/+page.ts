/**
 * One prerendered page per game, on the web build.
 *
 * `prerender` is the build-mode flag from vite.config.ts: true on the web,
 * false for Tauri (3,650 HTML files is real APK weight - the packaged apps
 * resolve game pages through the SPA fallback instead).
 *
 * The load returns only the build-time SEED (lib/game-seed.ts): the
 * slow-changing fields, so a crawler - which never accepts the terms and so
 * never loads the catalogue - still gets the real page. Players, peak and
 * reviews are never baked in; the page reads those from the live catalogue.
 *
 * This is a UNIVERSAL load on purpose. A +page.server.ts would make every
 * client-side navigation fetch /games/<appid>/__data.json, and for a game added
 * after the last deploy that file does not exist: the host answers with
 * index.html at HTTP 200, SvelteKit fails to parse it, and the page errors.
 * Here the browser half reads the seed back out of the page's own #game-seed
 * block (build/game-seeds.ts) - the same value the server rendered with, so
 * hydration matches, and null after a client-side navigation, where the live
 * catalogue is what renders.
 */
import { seedAppids, seedFor } from "virtual:game-seeds";
import type { EntryGenerator, PageLoad } from "./$types";

export const prerender = __PRERENDER_GAMES__;

export const entries: EntryGenerator = () => seedAppids().map((appid) => ({ appid }));

export const load: PageLoad = ({ params }) => ({ seed: seedFor(params.appid) });
