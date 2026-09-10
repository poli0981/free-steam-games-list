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
