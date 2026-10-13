import { describe, expect, it } from "vitest";
import { readCatalogue } from "./records";
import { sha256Hex } from "./hash";

function line(appid: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    link: `https://store.steampowered.com/app/${appid}/`,
    name: `Game ${appid}`,
    header_image: "h.jpg",
    description: "d",
    tags: ["x"],
    languages: ["English"],
    language_details: [{ name: "English" }],
    developer: ["D"],
    publisher: ["P"],
    release_date: "Aug 21, 2012",
    genre: "Action",
    type_game: "offline",
    safe: "y",
    ...extra,
  });
}

async function dataset(shards: string[][], opts: { stale?: number } = {}) {
  const texts = shards.map((rows) => rows.join("\n") + "\n");
  const files = await Promise.all(
    texts.map(async (t, i) => ({ name: `data_00${i + 1}.jsonl`, count: 0, sha256: await sha256Hex(t) })),
  );
  const fetched: string[] = [];
  const fetchText = async (path: string, ttl: number) => {
    fetched.push(`${path}@${ttl}`);
    if (path === "data/index.json") return JSON.stringify({ last_updated: "t", files });
    const i = files.findIndex((f) => `data/${f.name}` === path);
    if (i < 0) return null;
    // A lagging edge copy: wrong bytes until asked past the cache.
    if (opts.stale === i && ttl > 0) return "stale\n";
    return texts[i];
  };
  return { fetchText, fetched };
}

describe("readCatalogue", () => {
  it("projects every game once, in shard order, with its quality issues", async () => {
    const { fetchText } = await dataset([[line("1"), line("2", { safe: "?", tags: [] })], [line("3"), line("1")]]);
    const cat = await readCatalogue(fetchText);
    expect(cat?.verified).toBe(true);
    expect(cat?.games.map((g) => g.appid)).toEqual(["1", "2", "3"]);
    expect(cat?.byAppid.get("2")?.issues).toEqual(["safe-unreviewed", "no-tags"]);
    expect(cat?.byAppid.get("1")?.issues).toEqual([]);
  });

  it("re-reads a shard that does not match its hash, past the edge cache", async () => {
    const { fetchText, fetched } = await dataset([[line("1")]], { stale: 0 });
    const cat = await readCatalogue(fetchText);
    expect(cat?.verified).toBe(true);
    expect(fetched).toContain("data/data_001.jsonl@0");
  });

  it("keeps a verified read for the same generation, and only that", async () => {
    const { fetchText, fetched } = await dataset([[line("1")]]);
    const a = await readCatalogue(fetchText);
    const before = fetched.length;
    const b = await readCatalogue(fetchText);
    expect(b).toBe(a);
    expect(fetched.length).toBe(before + 1); // only the index again
  });

  it("gives up on a missing shard rather than reading a partial catalogue", async () => {
    const { fetchText } = await dataset([[line("1")]]);
    const broken = async (path: string, ttl: number) => (path.endsWith("001.jsonl") ? null : fetchText(path, ttl));
    expect(await readCatalogue(broken)).toBeNull();
  });
});
