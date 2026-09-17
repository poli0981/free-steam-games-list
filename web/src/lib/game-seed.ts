/**
 * The build-time snapshot a prerendered game page is rendered from.
 *
 * A game page has to show real content to a reader who has not accepted the
 * terms yet - which includes every crawler, since none of them ever will - and
 * that reader never downloads the catalogue. So the SLOW-CHANGING fields are
 * read from data/ at build time and baked into the page.
 *
 * The VOLATILE fields (players, peak, reviews, metacritic, last_updated) are
 * deliberately absent. Daily data commits do not rebuild the site, so a baked
 * player count would be days old on the page; those come only from the live
 * catalogue once it loads.
 *
 * This file must stay free of Svelte, $lib aliases and browser globals:
 * build/game-seeds.ts imports it from vite.config.ts, in Node.
 */

export interface GameSeed {
  appid: string;
  link: string;
  name: string;
  description: string;
  header_image: string;
  genre: string;
  type_game: string;
  developer: string[];
  publisher: string[];
  release_date: string;
  platforms: string[];
  languages: string[];
  tags: string[];
  anti_cheat: string;
  anti_cheat_note: string;
  is_kernel_ac: boolean | null;
  has_paid_dlc: boolean;
  drm_notes: string;
  notes: string;
  safe: string;
  status: string;
  is_dead: boolean;
  added_at: string;
}

/** The element id the seed travels in. See seedScript(). */
export const SEED_ELEMENT_ID = "game-seed";

const APPID_RE = /\/app\/(\d+)/;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : [];

/** A record (from a shard, or the live catalogue) reduced to its seed. */
export function toSeed(input: object): GameSeed | null {
  const record = input as Record<string, unknown>;
  const link = str(record.link);
  const appid = APPID_RE.exec(link)?.[1];
  if (!appid) return null;
  return {
    appid,
    link,
    name: str(record.name),
    description: str(record.description),
    header_image: str(record.header_image),
    genre: str(record.genre),
    type_game: str(record.type_game),
    developer: list(record.developer),
    publisher: list(record.publisher),
    release_date: str(record.release_date),
    platforms: list(record.platforms),
    languages: list(record.languages),
    tags: list(record.tags),
    anti_cheat: str(record.anti_cheat),
    anti_cheat_note: str(record.anti_cheat_note),
    is_kernel_ac: typeof record.is_kernel_ac === "boolean" ? record.is_kernel_ac : null,
    has_paid_dlc: record.has_paid_dlc === true,
    drm_notes: str(record.drm_notes),
    notes: str(record.notes),
    safe: str(record.safe),
    status: str(record.status),
    is_dead: record.is_dead === true,
    added_at: str(record.added_at),
  };
}

/**
 * The seed as a JSON data block, for the page body.
 *
 * The page's universal load() runs again in the browser during hydration, and
 * it must return the SAME seed there or hydration mismatches - so the browser
 * half reads it back out of this element (see build/game-seeds.ts).
 * `type="application/json"` is never executed, so `script-src` does not apply,
 * and escaping `<` stops a "</script>" inside a description from closing the
 * block early.
 */
export function seedScript(seed: GameSeed): string {
  const json = JSON.stringify(seed).replace(/</g, "\\u003c");
  return `<script type="application/json" id="${SEED_ELEMENT_ID}" data-appid="${seed.appid}">${json}</script>`;
}
