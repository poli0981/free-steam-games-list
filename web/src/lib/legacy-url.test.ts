import { afterEach, describe, expect, it, vi } from "vitest";

const goto = vi.hoisted(() => vi.fn());
vi.mock("$app/navigation", () => ({ goto }));

import { upgradeLegacyHashUrl } from "./legacy-url";

const ORIGIN = "https://free-steam-games.win";

/** A page loaded at `/` + hash, as a 1.4.x link or the old Pages tombstone sends it. */
function loadWithHash(hash: string) {
  vi.stubGlobal("window", { location: { hash, origin: ORIGIN } });
}

describe("upgradeLegacyHashUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    goto.mockReset();
  });

  it("does nothing outside a browser", () => {
    upgradeLegacyHashUrl();
    expect(goto).not.toHaveBeenCalled();
  });

  it.each(["", "#", "#section", "#games/730"])("leaves the hash %j alone", (hash) => {
    loadWithHash(hash);
    upgradeLegacyHashUrl();
    expect(goto).not.toHaveBeenCalled();
  });

  it.each([
    ["#/games/730", "/games/730"],
    ["#/games?q=dota", "/games?q=dota"],
    ["#/", "/"],
  ])("renders %s as %s in place of the history entry", (hash, path) => {
    goto.mockResolvedValue(undefined);
    loadWithHash(hash);
    upgradeLegacyHashUrl();
    expect(goto).toHaveBeenCalledOnce();
    const [url, options] = goto.mock.calls[0];
    expect(String(url)).toBe(`${ORIGIN}${path}`);
    expect(options).toEqual({ replace: true, reset: false });
  });

  it.each(["#//other.example/games/730", "#/\\other.example/games/730"])(
    "never leaves the site for %s",
    (hash) => {
      loadWithHash(hash);
      upgradeLegacyHashUrl();
      expect(goto).not.toHaveBeenCalled();
    },
  );

  it("sends a path that matches no route to the 404 page", async () => {
    goto.mockRejectedValueOnce(new Error("Cannot find a route for /no-such-page")).mockResolvedValue(undefined);
    loadWithHash("#/no-such-page");
    upgradeLegacyHashUrl();
    await vi.waitFor(() => expect(goto).toHaveBeenLastCalledWith("/error/404", { replace: true }));
  });
});
