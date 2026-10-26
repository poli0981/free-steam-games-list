import { beforeEach, describe, expect, it, vi } from "vitest";

const chunk = vi.hoisted(() => ({ isChunkLoadError: vi.fn(), reloadOnceForStaleChunk: vi.fn() }));
vi.mock("#lib/chunk-error.js", () => chunk);

import { handleError } from "./hooks.client";

/** The hook as SvelteKit 3 calls it: every error, with its kind. */
function run(error: unknown, kind: "app" | "framework" | "unknown" = "unknown") {
  return handleError({ kind, error, event: {} } as Parameters<typeof handleError>[0]);
}

describe("hooks.client handleError", () => {
  beforeEach(() => {
    chunk.isChunkLoadError.mockReset();
    chunk.reloadOnceForStaleChunk.mockReset();
  });

  it("returns nothing for an ordinary error, so SvelteKit keeps its status and message", () => {
    chunk.isChunkLoadError.mockReturnValue(false);
    expect(run(new Error("boom"))).toBeUndefined();
    expect(run({ status: 404, message: "Not Found" }, "framework")).toBeUndefined();
    expect(chunk.reloadOnceForStaleChunk).not.toHaveBeenCalled();
  });

  it("says it is reloading when a stale chunk starts the one reload", () => {
    chunk.isChunkLoadError.mockReturnValue(true);
    chunk.reloadOnceForStaleChunk.mockReturnValue(true);
    expect(run(new TypeError("Failed to fetch dynamically imported module"))).toEqual({
      message: "Reloading to pick up the latest version",
    });
  });

  it("lets the error show once the tab has already reloaded for it", () => {
    chunk.isChunkLoadError.mockReturnValue(true);
    chunk.reloadOnceForStaleChunk.mockReturnValue(false);
    expect(run(new TypeError("Failed to fetch dynamically imported module"))).toBeUndefined();
  });
});
