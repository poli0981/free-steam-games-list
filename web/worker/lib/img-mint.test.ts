import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectSources, mintImages } from "./img-mint";
import { avifKey } from "./img-store";
import { acquireLease, readState, writeState } from "./locks";
import { fakeDeps, makeEnv } from "../testing/fixtures";
import { FakeImages, FakeR2 } from "../testing/media-fakes";

/**
 * The cron is the ONLY place a billed transformation happens, so these pin the
 * budget (fail closed, counted before the call), the source of truth (only
 * shards that hash to the index), and progress (most-played first, resumable).
 */

const NOW = new Date("2026-10-02T12:00:00Z");
const COUNTER = "img_transforms:2026-10";
const AKAMAI = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";

function record(appid: number, players: string, header?: string): string {
  return JSON.stringify({
    link: `https://store.steampowered.com/app/${appid}/`,
    name: `Game ${appid}`,
    header_image: header ?? `${AKAMAI}/${appid}/header.jpg?t=17000000${appid % 100}`,
    current_players: players,
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A dataset whose index records the shard's real hash (or a wrong one). */
async function dataset(lines: string[], opts: { wrongHash?: boolean; lastUpdated?: string } = {}) {
  const shard = lines.join("\n") + "\n";
  const sha = opts.wrongHash ? "0".repeat(64) : await sha256Hex(shard);
  return {
    "data/index.json": JSON.stringify({
      last_updated: opts.lastUpdated ?? "2026-10-02T00:23:39Z",
      files: [{ name: "data_001.jsonl", count: lines.length, sha256: sha }],
    }),
    "data/data_001.jsonl": shard,
  };
}

let bucket: FakeR2;
let images: FakeImages;
let steam: ReturnType<typeof vi.fn>;

function envWith(vars: Record<string, string> = {}) {
  const base = makeEnv();
  return {
    ...base,
    MEDIA: bucket.asBinding(),
    IMAGES: images.asBinding(),
    IMG_TRANSFORM: "true",
    IMG_TRANSFORM_MONTHLY_CAP: "100",
    IMG_MINT_PER_TICK: "2",
    ...vars,
  } as unknown as Env & { sqlite: typeof base.sqlite };
}

beforeEach(() => {
  bucket = new FakeR2();
  images = new FakeImages();
  steam = vi.fn(async (url: string) =>
    url.includes("/404/") ? new Response("gone", { status: 404 }) : new Response(`JPEG ${url}`),
  );
  vi.stubGlobal("fetch", steam);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mintImages", () => {
  it("mints the most-played sources first, both widths, counted before the call", async () => {
    const env = envWith();
    const raw = await dataset([record(10, "5"), record(20, "492,197"), record(30, "1,000"), record(40, "N/A")]);
    const out = await mintImages(env, fakeDeps({ raw, now: NOW }));

    expect(out).toEqual({ minted: 2, failed: 0, remaining: 2, used: 4 });
    // 492,197 then 1,000.
    expect(steam.mock.calls.map(([u]) => u)).toEqual([`${AKAMAI}/20/header.jpg?t=1700000020`, `${AKAMAI}/30/header.jpg?t=1700000030`]);
    expect(images.calls.map((c) => [c.width, c.quality, c.format, c.fit])).toEqual([
      [230, 55, "image/avif", "scale-down"],
      [460, 60, "image/avif", "scale-down"],
      [230, 55, "image/avif", "scale-down"],
      [460, 60, "image/avif", "scale-down"],
    ]);
    const src = { path: "20/header.jpg", stamp: "1700000020" };
    expect(bucket.objects.get(avifKey(460, src))?.httpMetadata?.contentType).toBe("image/avif");
    expect(bucket.objects.get(avifKey(230, src))?.customMetadata).toEqual({ src: "20/header.jpg?t=1700000020", quality: "55" });
    expect(await readState(env.DB, COUNTER)).toBe("4");
  });

  it("resumes on the next tick and then goes quiet until the dataset changes", async () => {
    const env = envWith();
    const raw = await dataset([record(10, "5"), record(20, "9"), record(30, "7")]);
    await mintImages(env, fakeDeps({ raw, now: NOW }));
    const second = await mintImages(env, fakeDeps({ raw, now: NOW }));
    expect(second).toEqual({ minted: 1, failed: 0, remaining: 0, used: 6 });

    const lists = bucket.lists;
    const third = await mintImages(env, fakeDeps({ raw, now: NOW }));
    expect(third).toEqual({ skipped: "up to date", used: 6 });
    expect(bucket.lists).toBe(lists);

    // New art for one game (a new ?t=) is a new source: only it is minted.
    const changed = await dataset([record(10, "5", `${AKAMAI}/10/header.jpg?t=1800000000`), record(20, "9"), record(30, "7")], {
      lastUpdated: "2026-10-03T00:00:00Z",
    });
    const fourth = await mintImages(env, fakeDeps({ raw: changed, now: NOW }));
    expect(fourth).toEqual({ minted: 1, failed: 0, remaining: 0, used: 8 });
  });

  it("downloads the shards once per dataset generation, not once per tick", async () => {
    const env = envWith({ IMG_MINT_PER_TICK: "1" });
    const deps = fakeDeps({ raw: await dataset([record(10, "5"), record(20, "9"), record(30, "7")]), now: NOW });
    const fetchRaw = vi.spyOn(deps, "fetchRaw");

    await mintImages(env, deps);
    expect(fetchRaw.mock.calls.map(([p]) => p)).toEqual(["data/index.json", "data/data_001.jsonl"]);

    fetchRaw.mockClear();
    const second = await mintImages(env, deps);
    expect(second).toEqual({ minted: 1, failed: 0, remaining: 1, used: 4 });
    // Only the index, to learn the generation; the list came from the marker,
    // still most-played first (20 then 30, then 10).
    expect(fetchRaw.mock.calls.map(([p]) => p)).toEqual(["data/index.json"]);
    expect(steam.mock.calls.map(([u]) => u).at(-1)).toBe(`${AKAMAI}/30/header.jpg?t=1700000030`);
  });

  it("mints only the width that is missing", async () => {
    const env = envWith();
    bucket.seed(avifKey(460, { path: "20/header.jpg", stamp: "1700000020" }));
    const out = await mintImages(env, fakeDeps({ raw: await dataset([record(20, "9")]), now: NOW }));
    expect(out).toEqual({ minted: 1, failed: 0, remaining: 0, used: 1 });
    expect(images.calls.map((c) => c.width)).toEqual([230]);
  });

  it("refuses shards that do not hash to the index (GitHub's raw CDN lagging a commit)", async () => {
    const env = envWith();
    const out = await mintImages(env, fakeDeps({ raw: await dataset([record(20, "9")], { wrongHash: true }), now: NOW }));
    expect(out).toEqual({ skipped: "shard not yet updated", used: 0 });
    expect(images.calls).toEqual([]);
    expect(bucket.puts).toEqual([]);
  });

  it("stops at the monthly cap and never starts a source it cannot finish", async () => {
    const env = envWith({ IMG_TRANSFORM_MONTHLY_CAP: "3" });
    const raw = await dataset([record(20, "9"), record(30, "7")]);
    const out = await mintImages(env, fakeDeps({ raw, now: NOW }));
    expect(out).toMatchObject({ minted: 1, used: 2 });
    expect(images.calls).toHaveLength(2);

    const again = await mintImages(env, fakeDeps({ raw, now: NOW }));
    expect(again).toMatchObject({ minted: 0, used: 2, remaining: 1 });

    await writeState(env.DB, COUNTER, "3", NOW);
    expect(await mintImages(env, fakeDeps({ raw, now: NOW }))).toEqual({ skipped: "monthly cap reached", used: 3 });
  });

  it("counts per calendar month", async () => {
    const env = envWith();
    await writeState(env.DB, "img_transforms:2026-09", "100", NOW);
    const out = await mintImages(env, fakeDeps({ raw: await dataset([record(20, "9")]), now: NOW }));
    expect(out).toMatchObject({ minted: 1, used: 2 });
  });

  it("skips a source Steam cannot serve, without counting it, until the dataset changes", async () => {
    const env = envWith();
    const raw = await dataset([record(20, "9", `${AKAMAI}/404/header.jpg?t=1`), record(30, "7")]);
    const first = await mintImages(env, fakeDeps({ raw, now: NOW }));
    expect(first).toEqual({ minted: 1, failed: 1, remaining: 0, used: 2 });

    steam.mockClear();
    const second = await mintImages(env, fakeDeps({ raw, now: NOW }));
    expect(second).toEqual({ skipped: "up to date", used: 2 });
    expect(steam).not.toHaveBeenCalled();
  });

  it("treats Images error 9422 as the month's allowance spent, for every isolate", async () => {
    const env = envWith();
    images.failWith = Object.assign(new Error("ERROR 9422: exceeded"), { code: 9422 });
    const out = await mintImages(env, fakeDeps({ raw: await dataset([record(20, "9"), record(30, "7")]), now: NOW }));
    expect(out).toMatchObject({ minted: 0, used: 100 });
    expect(await readState(env.DB, COUNTER)).toBe("100");
  });

  it.each([
    [{ IMG_TRANSFORM: "false" }, "disabled"],
    [{ IMG_TRANSFORM_MONTHLY_CAP: "" }, "no monthly cap"],
    [{ IMG_TRANSFORM_MONTHLY_CAP: "0" }, "no monthly cap"],
  ])("does nothing with %o", async (vars, skipped) => {
    const env = envWith(vars);
    const out = await mintImages(env, fakeDeps({ raw: await dataset([record(20, "9")]), now: NOW }));
    expect(out).toEqual({ skipped });
    expect(images.calls).toEqual([]);
  });

  it("does nothing without its bindings", async () => {
    const env = { ...envWith(), MEDIA: undefined } as unknown as Env;
    expect(await mintImages(env, fakeDeps({ raw: await dataset([record(20, "9")]), now: NOW }))).toEqual({
      skipped: "bindings missing",
    });
  });

  it("fails closed when the state tables are missing", async () => {
    const env = envWith();
    env.sqlite.db.exec("DROP TABLE admin_locks; DROP TABLE admin_state;");
    expect(await mintImages(env, fakeDeps({ raw: await dataset([record(20, "9")]), now: NOW }))).toEqual({
      skipped: "state unavailable",
    });
    expect(images.calls).toEqual([]);
  });

  it("leaves a run held by another isolate alone", async () => {
    const env = envWith();
    await acquireLease(env.DB, "img-mint", "someone-else", 60_000, NOW);
    expect(await mintImages(env, fakeDeps({ raw: await dataset([record(20, "9")]), now: NOW }))).toEqual({
      skipped: "another run in progress",
    });
  });
});

describe("collectSources", () => {
  it("dedupes versions, ignores non-proxyable art and sorts by players", () => {
    const shard = [
      record(20, "1,500"),
      record(21, "N/A", `${AKAMAI}/20/header.jpg?t=1700000020`),
      record(30, "2,000", "https://cdn.akamai.steamstatic.com/steam/apps/30/header.jpg"),
      record(40, "12"),
      JSON.stringify({ link: "https://store.steampowered.com/app/50/", header_image: "", current_players: "1" }),
      "",
    ].join("\n");
    const got = collectSources([shard]);
    expect(got.map((c) => [c.key, c.players])).toEqual([
      ["20/header.jpg?t=1700000020", 1500],
      ["40/header.jpg?t=1700000040", 12],
    ]);
  });
});
