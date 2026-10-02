import { describe, expect, it } from "vitest";
import { parseSteamImage, sourceKey } from "./steam-image";

describe("parseSteamImage", () => {
  it("takes the proxyable path and Steam's ?t= from either host", () => {
    expect(parseSteamImage("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg?t=1749053861")).toEqual({
      path: "730/header.jpg",
      stamp: "1749053861",
    });
    expect(
      parseSteamImage(
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/8500/fed1ea9b01dd6564101518a5201740fb44929fb4/capsule_231x87.jpg",
      ),
    ).toEqual({ path: "8500/fed1ea9b01dd6564101518a5201740fb44929fb4/capsule_231x87.jpg", stamp: null });
  });

  it.each(["", "https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg", "https://example.com/730/header.jpg"])(
    "refuses %s",
    (url) => {
      expect(parseSteamImage(url)).toBeNull();
    },
  );
});

describe("sourceKey", () => {
  it("names one version of one image", () => {
    expect(sourceKey({ path: "730/header.jpg", stamp: "1749053861" })).toBe("730/header.jpg?t=1749053861");
    expect(sourceKey({ path: "730/header.jpg", stamp: null })).toBe("730/header.jpg");
  });
});
