import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Resource } from "./resource.svelte";
import { withoutBlockComments } from "./testing/source";

/**
 * Nothing loads before the reader is past the first-run gates.
 *
 * The root layout held the catalogue back until consent, but /activity and
 * /charts/delisted called load() from an $effect of their own, and the
 * activity feed also refetched on window focus - so both fetched before the
 * terms were accepted, and later before the human check. The gate now lives
 * in Resource itself (`enabled`), and every Resource must pass appReady.
 */

describe("Resource's enabled option", () => {
  it("starts no load, focus refetch or retry while disabled", async () => {
    let open = false;
    const fetcher = vi.fn(async () => "data");
    const res = new Resource(fetcher, { enabled: () => open });

    await res.load();
    await res.refetch();
    expect(fetcher).not.toHaveBeenCalled();
    expect(res.pending).toBe(true);

    open = true;
    await res.load();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(res.data).toBe("data");
  });

  it("stays open by default, for a Resource that has no gate to wait for", async () => {
    const fetcher = vi.fn(async () => 1);
    await new Resource(fetcher).load();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("every Resource in the app waits for appReady", () => {
  const SRC = join(process.cwd(), "src");

  function sources(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) sources(full, acc);
      else if (/\.(svelte|ts)$/.test(name) && !name.endsWith(".test.ts")) acc.push(full);
    }
    return acc;
  }

  /** The text of each `new Resource(...)` call, parentheses balanced. */
  function constructions(text: string): string[] {
    const out: string[] = [];
    for (let at = text.indexOf("new Resource"); at !== -1; at = text.indexOf("new Resource", at + 1)) {
      const open = text.indexOf("(", at);
      let depth = 0;
      let end = open;
      for (; end < text.length; end++) {
        if (text[end] === "(") depth++;
        else if (text[end] === ")" && --depth === 0) break;
      }
      out.push(text.slice(at, end + 1));
    }
    return out;
  }

  const found = sources(SRC).flatMap((file) =>
    constructions(withoutBlockComments(readFileSync(file, "utf-8"))).map((call) => ({
      file: relative(SRC, file).replace(/\\/g, "/"),
      call,
    })),
  );

  it("finds the app's resources", () => {
    // The catalogue, the removed-games list and the activity feed.
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  it("passes enabled: appReady to each", () => {
    const ungated = found.filter(({ call }) => !/\benabled:\s*appReady\b/.test(call)).map(({ file }) => file);
    expect(ungated).toEqual([]);
  });

  it("starts the root layout's network work only when appReady() allows it", () => {
    const layout = withoutBlockComments(readFileSync(join(SRC, "routes", "+layout.svelte"), "utf-8"));
    expect(layout).toMatch(/if \(!appReady\(\)\) return;\s*void games\.load\(\);\s*void pwa\.register\(\);\s*loadAnalytics\(\);/);
  });
});
