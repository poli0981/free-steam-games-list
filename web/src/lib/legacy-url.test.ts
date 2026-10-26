import { afterEach, describe, expect, it, vi } from "vitest";

const goto = vi.hoisted(() => vi.fn());
vi.mock("$app/navigation", () => ({ goto }));

import { upgradeLegacyHashUrl } from "./legacy-url";

/** A page loaded at `/` + hash, as a 1.4.x link or the old Pages tombstone sends it. */
function loadWithHash(hash: string) {
  const replace = vi.fn();
  vi.stubGlobal("window", { location: { hash } });
  vi.stubGlobal("location", { hash, replace });
  return replace;
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
    expect(goto).toHaveBeenCalledWith(path, { replace: true, reset: false });
  });

  it("loads a path that matches no route natively, where it gets the 404 view", async () => {
    goto.mockRejectedValue(new Error("Cannot find a route for /no-such-page"));
    const replace = loadWithHash("#/no-such-page");
    upgradeLegacyHashUrl();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/no-such-page"));
  });
});
