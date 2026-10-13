/**
 * Read ONE game record out of the published dataset.
 *
 * data/ is ~6 MB across five shards. The edit screen needs a single record, so
 * this never parses the dataset: it fetches shards as text, finds the literal
 * canonical link `/app/<appid>/`, slices that one line to its newline
 * boundaries, and JSON.parses only that. Anchored on both sides by the link
 * format, so it cannot match a longer appid or hit text inside a description.
 *
 * Shard identity is deliberately not retained anywhere. save_main() re-chunks
 * the whole catalogue into 800-record files on every run, so a game moves
 * between data_001 and data_005 as records are added or removed; the shard a
 * record was found in is true only for this request.
 */

import { sha256Hex } from "./hash";
import { qualityIssues, type QualityCheck } from "../../shared/quality";

const RAW_BASE =
  "https://raw.githubusercontent.com/poli0981/free-steam-games-list/main";

/**
 * Same URLs the public /api/data/* proxy serves, so these reads mostly land on
 * an already-warm edge cache. 300s matches that proxy's shard TTL; a record
 * that is five minutes stale is fine for an edit form, because the override is
 * written against field VALUES the reviewer can see, not against a revision.
 */
const SHARD_TTL = 300;

export interface GameRecord {
  link: string;
  name?: string;
  [k: string]: unknown;
}

/**
 * One repository file as text, through Cloudflare's edge cache for `ttl`
 * seconds (0 bypasses it). Exported as a dependency so the admin handlers and
 * reconcile can be run against fixture data in tests and in `npm run
 * dev:admin`.
 */
export async function fetchRaw(path: string, ttl: number): Promise<string | null> {
  const res = await fetch(`${RAW_BASE}/${path}`, {
    cf: { cacheTtl: ttl, cacheEverything: true },
    headers: { Accept: "text/plain, application/json, */*" },
  });
  return res.ok ? await res.text() : null;
}

async function shardNames(): Promise<string[]> {
  // index.json is ~170 bytes and is the catalogue's own manifest; hardcoding
  // five shard names would break the day the catalogue crosses 4,000 games.
  const text = await fetchRaw("data/index.json", 30);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { files?: { name?: unknown }[] };
    return (parsed.files ?? [])
      .map((f) => f?.name)
      .filter((n): n is string => typeof n === "string" && /^data_\d{3}\.jsonl$/.test(n));
  } catch {
    return [];
  }
}

/** The record for `appid`, or null if the catalogue does not have it. */
export async function findRecord(appid: string): Promise<GameRecord | null> {
  if (!/^\d{1,10}$/.test(appid)) return null;
  const names = await shardNames();
  if (!names.length) return null;

  const needle = `/app/${appid}/`;
  for (const name of names) {
    const text = await fetchRaw(`data/${name}`, SHARD_TTL);
    if (!text) continue;
    const hit = text.indexOf(needle);
    if (hit < 0) continue;

    const start = text.lastIndexOf("\n", hit) + 1;
    const endRaw = text.indexOf("\n", hit);
    const end = endRaw < 0 ? text.length : endRaw;
    try {
      const rec = JSON.parse(text.slice(start, end)) as GameRecord;
      // The needle can appear in a field other than `link` (a note quoting a
      // store URL, say). Confirm we found the record we were asked for.
      if (typeof rec.link === "string" && rec.link.includes(needle)) return rec;
    } catch {
      // A shard line that will not parse is the pipeline's problem, not ours.
    }
  }
  return null;
}

/** The override document for `appid`, or null when there is none. */
export async function findOverride(appid: string): Promise<Record<string, unknown> | null> {
  if (!/^\d{1,10}$/.test(appid)) return null;
  // TTL 0, unlike the shards: a stale override read would let the edit screen
  // build its next version on top of a superseded one and silently drop
  // somebody's `was` value.
  const text = await fetchRaw(`data/overrides/${appid}.json`, 0);
  if (!text) return null;
  try {
    const doc = JSON.parse(text) as Record<string, unknown>;
    return doc && typeof doc === "object" ? doc : null;
  } catch {
    return null;
  }
}


/**
 * Every genre in use, with how many games carry it.
 *
 * Extracted by regex rather than by parsing 3,400 records: the value is only
 * needed to populate a dropdown, and a full JSON.parse of ~6 MB to count one
 * string field would be several seconds of Worker CPU for nothing.
 */
export async function genreCounts(): Promise<{ genre: string; count: number }[]> {
  const names = await shardNames();
  const counts = new Map<string, number>();
  // Non-greedy over an escaped-string body, so a genre containing an escaped
  // quote still terminates in the right place.
  const re = /"genre"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

  for (const name of names) {
    const text = await fetchRaw(`data/${name}`, SHARD_TTL);
    if (!text) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      let g: string;
      try {
        g = JSON.parse(`"${m[1]}"`) as string;
      } catch {
        continue;
      }
      if (!g) continue;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

export interface GameSummary {
  appid: string;
  name: string;
  genre: string;
  header_image: string;
  release_date: string;
}

/**
 * Games carrying exactly `genre`, for the bulk-retag screen.
 *
 * Candidate lines are found by substring first and only then parsed, so the
 * cost is proportional to how many games share the genre rather than to the
 * size of the catalogue.
 */
export async function listByGenre(
  genre: string,
  limit: number,
  offset: number,
): Promise<{ total: number; items: GameSummary[] }> {
  const names = await shardNames();
  const needle = `"genre": ${JSON.stringify(genre)}`;
  const alt = `"genre":${JSON.stringify(genre)}`; // in case a writer omits the space
  const items: GameSummary[] = [];
  let total = 0;

  for (const name of names) {
    const text = await fetchRaw(`data/${name}`, SHARD_TTL);
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line || (!line.includes(needle) && !line.includes(alt))) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      // The substring can appear inside a description; only an exact field
      // match counts.
      if (rec.genre !== genre) continue;
      total++;
      if (total <= offset || items.length >= limit) continue;
      const link = typeof rec.link === "string" ? rec.link : "";
      const appid = link.match(/\/app\/(\d+)/)?.[1];
      if (!appid) continue;
      items.push({
        appid,
        name: typeof rec.name === "string" ? rec.name : "",
        genre,
        header_image: typeof rec.header_image === "string" ? rec.header_image : "",
        release_date: typeof rec.release_date === "string" ? rec.release_date : "",
      });
    }
  }
  return { total, items };
}


/** One catalogue game, as the admin screens need it - not the whole record. */
export interface CatalogueGame {
  appid: string;
  link: string;
  name: string;
  header_image: string;
  release_date: string;
  type_game: string;
  genre: string;
  is_dead: boolean;
  status: string;
  issues: QualityCheck[];
}

export interface Catalogue {
  /** Same shape as reconcile.ts's and img-mint.ts's, from data/index.json. */
  generation: string;
  /** Every shard hashed to what data/index.json records for it. */
  verified: boolean;
  games: CatalogueGame[];
  byAppid: Map<string, CatalogueGame>;
}

/**
 * The last VERIFIED read, per isolate. A read with a shard that did not match
 * its hash is returned but never kept: raw.githubusercontent.com can serve the
 * previous shard for ~5 minutes after a commit, and a copy built from it would
 * otherwise be frozen under the new generation (the img-mint lesson). Keyed on
 * the fetcher too, so tests and the mock server never share a copy.
 */
let memo: { fetcher: unknown; catalogue: Catalogue } | null = null;

/**
 * Every published game, read from the shards data/index.json lists.
 *
 * Only a projection is kept (name, art, a few fields and the quality issues):
 * ~6,600 full records with their language tables would be most of an
 * isolate's 128 MB. null when the index or a shard cannot be read at all - a
 * partial catalogue would read as "these games are not published".
 */
export async function readCatalogue(fetchText: typeof fetchRaw = fetchRaw): Promise<Catalogue | null> {
  const indexText = await fetchText("data/index.json", 0);
  if (!indexText) return null;
  let files: { name: string; sha256: string }[];
  let generation: string;
  try {
    const parsed = JSON.parse(indexText) as { last_updated?: unknown; files?: { name?: unknown; sha256?: unknown }[] };
    files = (parsed.files ?? []).flatMap((f) =>
      typeof f?.name === "string" && /^data_\d{3}\.jsonl$/.test(f.name)
        ? [{ name: f.name, sha256: typeof f.sha256 === "string" ? f.sha256 : "" }]
        : [],
    );
    generation = JSON.stringify([parsed.last_updated, files.map((f) => f.sha256 || f.name)]);
  } catch {
    return null;
  }
  if (!files.length) return null;
  if (memo && memo.fetcher === fetchText && memo.catalogue.generation === generation) return memo.catalogue;

  const texts = await Promise.all(files.map((f) => fetchText(`data/${f.name}`, SHARD_TTL)));
  let verified = true;
  for (let i = 0; i < files.length; i++) {
    if (texts[i] === null) return null;
    if (!/^[0-9a-f]{64}$/.test(files[i].sha256)) {
      verified = false;
      continue;
    }
    if ((await sha256Hex(texts[i]!)) === files[i].sha256) continue;
    // Stale edge copy: ask once more, past the cache.
    texts[i] = await fetchText(`data/${files[i].name}`, 0);
    if (texts[i] === null) return null;
    if ((await sha256Hex(texts[i]!)) !== files[i].sha256) verified = false;
  }

  const games: CatalogueGame[] = [];
  const byAppid = new Map<string, CatalogueGame>();
  for (const text of texts as string[]) {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const link = typeof rec.link === "string" ? rec.link : "";
      const appid = /\/app\/(\d+)/.exec(link)?.[1];
      // One entry per appid: a duplicate record must not become a duplicate
      // key in a keyed {#each} on the admin screens.
      if (!appid || byAppid.has(appid)) continue;
      const game: CatalogueGame = {
        appid,
        link,
        name: typeof rec.name === "string" ? rec.name : "",
        header_image: typeof rec.header_image === "string" ? rec.header_image : "",
        release_date: typeof rec.release_date === "string" ? rec.release_date : "",
        type_game: typeof rec.type_game === "string" ? rec.type_game : "",
        genre: typeof rec.genre === "string" ? rec.genre : "",
        is_dead: rec.is_dead === true,
        status: typeof rec.status === "string" ? rec.status : "",
        issues: qualityIssues(rec),
      };
      games.push(game);
      byAppid.set(appid, game);
    }
  }

  const catalogue: Catalogue = { generation, verified, games, byAppid };
  if (verified) memo = { fetcher: fetchText, catalogue };
  return catalogue;
}
