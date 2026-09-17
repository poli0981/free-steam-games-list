import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDesktopUpdates, newestDesktopTag, validLatest } from "./updates";

const REPO = "https://github.com/poli0981/free-steam-games-list";

function atom(tags: string[]): string {
  return `<?xml version="1.0"?><feed>${tags
    .map((t) => `<entry><link rel="alternate" type="text/html" href="${REPO}/releases/tag/${t}"/></entry>`)
    .join("")}</feed>`;
}

function latest(version: string, tag = `desktop-v${version}`) {
  return {
    version,
    notes: "Fixes",
    pub_date: "2026-09-20T00:00:00Z",
    platforms: {
      "windows-x86_64": { signature: "sig", url: `${REPO}/releases/download/${tag}/F2P.Tracker_${version}_x64-setup.exe` },
    },
  };
}

describe("newestDesktopTag", () => {
  it("picks the highest desktop version, ignoring the other release kinds", () => {
    expect(newestDesktopTag(atom(["v4.0.0", "android-v2.1.0", "desktop-v2.0.0", "desktop-v2.0.10", "desktop-v2.0.9"]))).toBe(
      "desktop-v2.0.10",
    );
  });

  it("ignores prerelease-shaped tags and returns null when there is none", () => {
    expect(newestDesktopTag(atom(["desktop-v3.0.0-beta.1", "v4.0.0"]))).toBeNull();
  });
});

describe("validLatest", () => {
  it("accepts a file that describes its own release", () => {
    expect(validLatest(latest("2.0.1"), "desktop-v2.0.1")?.version).toBe("2.0.1");
  });

  it("rejects a version that does not match the tag", () => {
    expect(validLatest(latest("2.0.0"), "desktop-v2.0.1")).toBeNull();
  });

  it("rejects an artefact URL outside this repository's release downloads", () => {
    const doc = latest("2.0.1");
    doc.platforms["windows-x86_64"].url = "https://example.com/evil.exe";
    expect(validLatest(doc, "desktop-v2.0.1")).toBeNull();
  });

  it("rejects missing signatures and empty platform lists", () => {
    const unsigned = latest("2.0.1");
    unsigned.platforms["windows-x86_64"].signature = "";
    expect(validLatest(unsigned, "desktop-v2.0.1")).toBeNull();
    expect(validLatest({ version: "2.0.1", platforms: {} }, "desktop-v2.0.1")).toBeNull();
  });
});

describe("handleDesktopUpdates", () => {
  const store = new Map<string, Response>();
  const upstream = vi.fn();
  const ctx = () => {
    const pending: Promise<unknown>[] = [];
    return {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException: () => {},
      props: {},
      settle: () => Promise.all(pending),
    };
  };
  const call = (c = ctx()) => {
    const url = new URL("https://free-steam-games.win/api/updates/desktop?target=windows");
    return { c, res: handleDesktopUpdates(new Request(url), url, c as unknown as ExecutionContext) };
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("caches", {
      default: {
        match: async (r: Request) => store.get(r.url)?.clone(),
        put: async (r: Request, res: Response) => void store.set(r.url, res.clone()),
      },
    });
    vi.stubGlobal("fetch", upstream);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    upstream.mockReset();
  });

  it("serves the newest desktop release's latest.json, and caches it", async () => {
    upstream.mockImplementation(async (input: string) =>
      input.endsWith("releases.atom")
        ? new Response(atom(["v4.0.0", "desktop-v2.0.1", "desktop-v2.0.0"]))
        : new Response(JSON.stringify(latest("2.0.1"))),
    );
    const first = call();
    const r = await first.res;
    expect(r.status).toBe(200);
    expect(((await r.json()) as { version: string }).version).toBe("2.0.1");
    expect(String(upstream.mock.calls[1][0])).toBe(`${REPO}/releases/download/desktop-v2.0.1/latest.json`);
    await first.c.settle();
    await call().res;
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("answers 204 when no desktop release exists", async () => {
    upstream.mockResolvedValue(new Response(atom(["v4.0.0", "android-v2.0.0"])));
    expect((await call().res).status).toBe(204);
  });

  it("answers 204, not an error, when GitHub is unreachable", async () => {
    upstream.mockRejectedValue(new TypeError("fetch failed"));
    expect((await call().res).status).toBe(204);
  });

  it("answers 204 when latest.json does not validate", async () => {
    upstream.mockImplementation(async (input: string) =>
      input.endsWith("releases.atom")
        ? new Response(atom(["desktop-v2.0.1"]))
        : new Response(JSON.stringify(latest("2.0.0"))),
    );
    expect((await call().res).status).toBe(204);
  });
});
