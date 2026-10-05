import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleImg } from "./img";
import { AVIF_VARIANTS, avifKey } from "../lib/img-store";
import { makeEnv } from "../testing/fixtures";
import { FakeImages, FakeR2 } from "../testing/media-fakes";

/**
 * /img is READ-ONLY: it serves what the cron minted, or Steam's JPEG. These
 * tests pin the three things that are easy to break - an AVIF-capable browser
 * must never keep a provisional JPEG, the legacy and social variants must
 * never become AVIF, and no request may transform.
 */

const ORIGIN = "https://free-steam-games.win";
const AVIF_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
const JPEG_ACCEPT = "image/webp,image/*,*/*;q=0.8";
const PLAIN = { path: "730/header.jpg", stamp: "1749053861" };
const HASHED_PATH = "8500/fed1ea9b01dd6564101518a5201740fb44929fb4/header.jpg";

class FakeCache {
  store = new Map<string, Response>();
  async match(req: Request): Promise<Response | undefined> {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response): Promise<void> {
    this.store.set(req.url, res.clone());
  }
}

function ctx() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
    settle: () => Promise.all(pending),
  };
}

let cache: FakeCache;
let upstream: ReturnType<typeof vi.fn>;
let bucket: FakeR2;
let images: FakeImages;
let env: Env;

/** Steam answers every header and the plain-path capsule; nothing else. */
function steam(url: string): Response {
  const u = new URL(url);
  if (u.pathname.endsWith("/header.jpg")) return new Response("JPEG-HEADER", { headers: { "Content-Type": "image/jpeg" } });
  if (u.pathname.endsWith("/730/capsule_184x69.jpg")) return new Response("JPEG-CAPSULE", { headers: { "Content-Type": "image/jpeg" } });
  return new Response("nope", { status: 404 });
}

async function call(path: string, accept: string, method = "GET") {
  const c = ctx();
  const url = new URL(`${ORIGIN}${path}`);
  const res = await handleImg(new Request(url, { method, headers: { Accept: accept } }), url, env, c as unknown as ExecutionContext);
  await c.settle();
  return res;
}

beforeEach(() => {
  cache = new FakeCache();
  vi.stubGlobal("caches", { default: cache });
  upstream = vi.fn(async (url: string) => steam(url));
  vi.stubGlobal("fetch", upstream);
  bucket = new FakeR2();
  images = new FakeImages();
  env = { ...makeEnv(), MEDIA: bucket.asBinding(), IMAGES: images.asBinding() } as unknown as Env;
});

afterEach(() => {
  vi.unstubAllGlobals();
  // The route must never transform, whatever the test did.
  expect(images.calls).toEqual([]);
});

describe("negotiated variants (s, d)", () => {
  it("serves the minted AVIF to a browser that accepts it", async () => {
    bucket.seed(avifKey(AVIF_VARIANTS.d, PLAIN), "AVIF-BYTES");
    const res = await call("/img/d/730/header.jpg?t=1749053861", AVIF_ACCEPT);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/avif");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("Vary")).toBe("Accept");
    expect(res.headers.get("X-Img-Final")).toBe("1");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="header.avif"');
    expect(await res.text()).toBe("AVIF-BYTES");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers a repeat from the edge cache, with Vary added on the way out", async () => {
    bucket.seed(avifKey(AVIF_VARIANTS.s, PLAIN), "AVIF-THUMB");
    await call("/img/s/730/header.jpg?t=1749053861", AVIF_ACCEPT);
    const gets = bucket.gets.length;

    const again = await call("/img/s/730/header.jpg?t=1749053861&junk=1", AVIF_ACCEPT);
    expect(await again.text()).toBe("AVIF-THUMB");
    expect(again.headers.get("Vary")).toBe("Accept");
    expect(bucket.gets.length).toBe(gets);
    // The cached copy itself carries no Vary: the Cache API ignores it.
    const stored = [...cache.store.entries()].find(([k]) => k.includes("/img/~avif/230q55/"));
    expect(stored?.[1].headers.get("Vary")).toBeNull();
  });

  it("stands in with a PROVISIONAL JPEG until the AVIF is minted", async () => {
    const res = await call("/img/d/730/header.jpg?t=1749053861", AVIF_ACCEPT);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(res.headers.get("X-Img-Final")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Accept");
    expect(await res.text()).toBe("JPEG-HEADER");
    expect(upstream).toHaveBeenCalledWith(
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg?t=1749053861",
      expect.anything(),
    );
    // Nothing is written anywhere under the AVIF key, and nothing to R2.
    expect([...cache.store.keys()].some((k) => k.includes("/img/~avif/"))).toBe(false);
    expect(bucket.puts).toEqual([]);
  });

  it("remembers an R2 miss for one cron tick, so a repeat skips the bucket", async () => {
    await call("/img/d/730/header.jpg?t=1749053861", AVIF_ACCEPT);
    expect(bucket.gets).toHaveLength(1);
    const marker = cache.store.get(`${ORIGIN}/img/~avif-miss/460q80/730/header.jpg?t=1749053861`);
    expect(marker?.headers.get("Cache-Control")).toBe("public, max-age=900");

    const again = await call("/img/d/730/header.jpg?t=1749053861&junk=1", AVIF_ACCEPT);
    expect(again.headers.get("Content-Type")).toBe("image/jpeg");
    expect(again.headers.get("X-Img-Final")).toBeNull();
    expect(bucket.gets).toHaveLength(1);
  });

  it("remembers a miss per encoding: a thumbnail not minted yet does not hide the hero", async () => {
    bucket.seed(avifKey(AVIF_VARIANTS.d, PLAIN), "AVIF-BYTES");
    await call("/img/s/730/header.jpg?t=1749053861", AVIF_ACCEPT);
    const res = await call("/img/d/730/header.jpg?t=1749053861", AVIF_ACCEPT);
    expect(res.headers.get("Content-Type")).toBe("image/avif");
  });

  it("gives a browser without AVIF the JPEG as its final answer", async () => {
    bucket.seed(avifKey(AVIF_VARIANTS.d, PLAIN), "AVIF-BYTES");
    const res = await call("/img/d/730/header.jpg?t=1749053861", JPEG_ACCEPT);

    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=2592000, immutable");
    expect(res.headers.get("X-Img-Final")).toBe("1");
    expect(res.headers.get("Vary")).toBe("Accept");
    expect(bucket.gets).toEqual([]);
  });

  it("degrades to the JPEG when the bucket is not bound", async () => {
    env = { ...makeEnv() } as unknown as Env;
    const res = await call("/img/s/730/header.jpg?t=1749053861", AVIF_ACCEPT);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("X-Img-Final")).toBeNull();
    // No bucket, no lookup - so nothing to remember as a miss either.
    expect([...cache.store.keys()].some((k) => k.includes("/img/~avif-miss/"))).toBe(false);
  });

  it("keys the R2 lookup on the source version, so a forged ?t= only misses", async () => {
    bucket.seed(avifKey(AVIF_VARIANTS.d, PLAIN), "AVIF-BYTES");
    const res = await call("/img/d/730/header.jpg?t=1", AVIF_ACCEPT);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(bucket.gets).toEqual([avifKey(AVIF_VARIANTS.d, { path: PLAIN.path, stamp: "1" })]);
    expect(bucket.puts).toEqual([]);
  });

  it("uses the thumbnail key for s, never the capsule", async () => {
    await call(`/img/s/${HASHED_PATH}?t=5`, AVIF_ACCEPT);
    expect(bucket.gets).toEqual([avifKey(AVIF_VARIANTS.s, { path: HASHED_PATH, stamp: "5" })]);
    expect(upstream.mock.calls.map(([u]) => u)).toEqual([
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${HASHED_PATH}?t=5`,
    ]);
  });
});

describe("key scheme", () => {
  it("names the encoding in every key, so a new quality is a new object", () => {
    expect(avifKey(AVIF_VARIANTS.d, PLAIN)).toBe("img/v2/460q80/730/header@1749053861.avif");
    expect(avifKey(AVIF_VARIANTS.s, { path: HASHED_PATH, stamp: null })).toBe(
      "img/v2/230q55/8500/fed1ea9b01dd6564101518a5201740fb44929fb4/header@0.avif",
    );
  });

  it("never serves an object minted under an older encoding", async () => {
    // What the first production batch wrote (d at q60, quality only in the prefix).
    bucket.seed("img/v1/460/730/header@1749053861.avif", "OLD-Q60");
    const res = await call("/img/d/730/header.jpg?t=1749053861", AVIF_ACCEPT);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("X-Img-Final")).toBeNull();
  });
});

describe("legacy and social variants (t, d2)", () => {
  it("d2 is always the JPEG, even for an AVIF browser and a minted copy", async () => {
    bucket.seed(avifKey(AVIF_VARIANTS.d, PLAIN), "AVIF-BYTES");
    const res = await call("/img/d2/730/header.jpg?t=1749053861", AVIF_ACCEPT);

    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Vary")).toBeNull();
    expect(res.headers.get("X-Img-Final")).toBe("1");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=2592000, immutable");
    expect(bucket.gets).toEqual([]);
  });

  it("t prefers Steam's capsule on an un-hashed path", async () => {
    const res = await call("/img/t/730/header.jpg?t=1749053861", AVIF_ACCEPT);
    expect(await res.text()).toBe("JPEG-CAPSULE");
    expect(upstream.mock.calls[0][0]).toContain("/730/capsule_184x69.jpg?t=1749053861");
  });

  it("t does not probe for a capsule on a hashed path, where none exists", async () => {
    const res = await call(`/img/t/${HASHED_PATH}`, AVIF_ACCEPT);
    expect(await res.text()).toBe("JPEG-HEADER");
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][0]).toContain(`/${HASHED_PATH}`);
  });
});

describe("cache keys and errors", () => {
  it("does not let stray query parameters fork the edge cache", async () => {
    await call("/img/d2/730/header.jpg?t=1749053861&junk=1", JPEG_ACCEPT);
    await call("/img/d2/730/header.jpg?junk=2&t=1749053861", JPEG_ACCEPT);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("answers HEAD with headers and no body", async () => {
    bucket.seed(avifKey(AVIF_VARIANTS.d, PLAIN), "AVIF-BYTES");
    const res = await call("/img/d/730/header.jpg?t=1749053861", AVIF_ACCEPT, "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/avif");
    expect(res.body).toBeNull();
  });

  it.each([
    ["/img/x/730/header.jpg", 404],
    ["/img/d/730/../header.jpg", 404],
    ["/img/d/730/HEADER.png", 404],
    ["/img/d", 404],
  ])("refuses %s", async (path, status) => {
    expect((await call(path, AVIF_ACCEPT)).status).toBe(status);
  });

  it("refuses other methods", async () => {
    expect((await call("/img/d/730/header.jpg", AVIF_ACCEPT, "POST")).status).toBe(405);
  });

  it("404s when Steam has no such image, and caches nothing", async () => {
    const res = await call("/img/d2/730/missing.jpg", JPEG_ACCEPT);
    expect(res.status).toBe(404);
    expect(cache.store.size).toBe(0);
  });
});

describe("URL transformations", () => {
  it("refuses to be a source for /cdn-cgi/image/, whatever the variant", async () => {
    bucket.seed(avifKey(AVIF_VARIANTS.d, PLAIN), "AVIF-BYTES");
    for (const path of ["/img/d2/730/header.jpg?t=1749053861", "/img/d/730/header.jpg?t=1749053861", "/img/gh/in/15368"]) {
      const c = ctx();
      const url = new URL(`${ORIGIN}${path}`);
      // What Cloudflare's resizer sends when it fetches a same-zone source
      // (measured with wrangler tail): the caller's UA, its own Via.
      const res = await handleImg(
        new Request(url, { headers: { Via: "1.1 image-resizing-proxy", "User-Agent": "curl/8.22.0" } }),
        url,
        env,
        c as unknown as ExecutionContext,
      );
      expect(res.status, path).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
    expect(bucket.gets).toEqual([]);
  });
});

describe("avatars", () => {
  it("are final, so the service worker may keep them", async () => {
    upstream.mockImplementation(async () => new Response("PNG", { headers: { "Content-Type": "image/png" } }));
    const res = await call("/img/gh/in/15368", AVIF_ACCEPT);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Img-Final")).toBe("1");
  });
});
