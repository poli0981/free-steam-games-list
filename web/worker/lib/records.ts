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

async function fetchText(path: string, ttl: number): Promise<string | null> {
  const res = await fetch(`${RAW_BASE}/${path}`, {
    cf: { cacheTtl: ttl, cacheEverything: true },
    headers: { Accept: "text/plain, application/json, */*" },
  });
  return res.ok ? await res.text() : null;
}

async function shardNames(): Promise<string[]> {
  // index.json is ~170 bytes and is the catalogue's own manifest; hardcoding
  // five shard names would break the day the catalogue crosses 4,000 games.
  const text = await fetchText("data/index.json", 30);
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
    const text = await fetchText(`data/${name}`, SHARD_TTL);
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
  const text = await fetchText(`data/overrides/${appid}.json`, 0);
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
    const text = await fetchText(`data/${name}`, SHARD_TTL);
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
    const text = await fetchText(`data/${name}`, SHARD_TTL);
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
