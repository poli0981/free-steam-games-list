import { afterEach, describe, expect, it, vi } from "vitest";
import { AVIF_VARIANTS, avifKey } from "../../shared/img-keys";
import { parseSteamImage } from "../../shared/steam-image";
import { headerToCapsule, heroFallback, heroImage, socialImagePath, thumbFallback } from "./image";
import { MEDIA_ORIGIN } from "./site";

/**
 * On the web, art comes from the media host - the R2 bucket's custom domain,
 * through Cloudflare's cache - and falls back to the Worker's /img route.
 * Under Tauri it comes from /img alone. The URL the page asks for must be the
 * EXACT key the cron minted (shared/img-keys.ts), or every image is a 404 that
 * the fallback quietly papers over.
 */

const AKAMAI = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg?t=1749053861";
const FASTLY_HASHED =
  "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/8500/fed1ea9b01dd6564101518a5201740fb44929fb4/header.jpg";

describe("on the web", () => {
  it("points thumbnails and the hero at the minted AVIF on the media host", () => {
    expect(headerToCapsule(AKAMAI)).toBe(`${MEDIA_ORIGIN}/img/v2/230q55/730/header@1749053861.avif`);
    expect(heroImage(AKAMAI)).toBe(`${MEDIA_ORIGIN}/img/v2/460q80/730/header@1749053861.avif`);
  });

  it("asks for exactly the key the cron writes", () => {
    for (const url of [AKAMAI, FASTLY_HASHED]) {
      const src = parseSteamImage(url)!;
      expect(headerToCapsule(url)).toBe(`${MEDIA_ORIGIN}/${avifKey(AVIF_VARIANTS.s, src)}`);
      expect(heroImage(url)).toBe(`${MEDIA_ORIGIN}/${avifKey(AVIF_VARIANTS.d, src)}`);
    }
  });

  it("names a source without ?t= as @0, and keeps the hash directory", () => {
    expect(heroImage(FASTLY_HASHED)).toBe(
      `${MEDIA_ORIGIN}/img/v2/460q80/8500/fed1ea9b01dd6564101518a5201740fb44929fb4/header@0.avif`,
    );
  });

  it("falls back to the Worker's negotiated variants, same-origin", () => {
    expect(thumbFallback(AKAMAI)).toBe("/img/s/730/header.jpg?t=1749053861");
    expect(heroFallback(AKAMAI)).toBe("/img/d/730/header.jpg?t=1749053861");
  });

  it("leaves a URL it does not recognise alone, with nothing to fall back to", () => {
    const other = "https://example.com/picture.jpg";
    expect(headerToCapsule(other)).toBe(other);
    expect(heroImage(other)).toBe(other);
    expect(thumbFallback(other)).toBeNull();
    expect(heroFallback(other)).toBeNull();
  });

  it("keeps the social card on d2, which is always JPEG", () => {
    expect(socialImagePath(AKAMAI)).toBe("/img/d2/730/header.jpg?t=1749053861");
  });
});

describe("under Tauri", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // API_ORIGIN is fixed when lib/site.ts loads, so the module is imported
  // fresh with the Tauri runtime already present.
  async function tauriImage() {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.resetModules();
    return import("./image");
  }

  it("goes through /img on the site, never the media host", async () => {
    const image = await tauriImage();
    expect(image.headerToCapsule(AKAMAI)).toBe("https://free-steam-games.win/img/s/730/header.jpg?t=1749053861");
    expect(image.heroImage(AKAMAI)).toBe("https://free-steam-games.win/img/d/730/header.jpg?t=1749053861");
  });

  it("has nothing to fall back to, because the primary already is /img", async () => {
    const image = await tauriImage();
    expect(image.thumbFallback(AKAMAI)).toBeNull();
    expect(image.heroFallback(AKAMAI)).toBeNull();
  });
});
