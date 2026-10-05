import type { RequestEvent } from "@sveltejs/kit";
import { describe, expect, it, vi } from "vitest";
import { handle } from "./hooks.server";

/** The hook as the prerenderer calls it, with the prerender origin. */
async function run(path: string) {
  const resolve = vi.fn(async () => new Response("page", { status: 200 }));
  const event = { url: new URL(`http://sveltekit-prerender${path}`) } as RequestEvent;
  const response = await handle({ event, resolve });
  return { response, resolve };
}

describe("hooks.server handle", () => {
  it.each([
    "/img/d2/440/header.jpg",
    "/img/t/8500/fed1ea9b01dd6564101518a5201740fb44929fb4/header.jpg",
    "/img/gh/in/15368",
    "/api/data/data/index.json",
  ])("answers the Worker route %s with a bare 404, without rendering the app", async (path) => {
    const { response, resolve } = await run(path);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(resolve).not.toHaveBeenCalled();
  });

  // Prefix precision: only /img/ and /api/ belong to the Worker, exactly as in
  // handleHttpError. A route that merely starts with the same letters must
  // still render, or its prerendered page would silently go missing.
  it.each(["/", "/games/730", "/legal/tos", "/sitemap.xml", "/imgs", "/api", "/apix/y"])(
    "lets the app render %s",
    async (path) => {
      const { response, resolve } = await run(path);
      expect(response.status).toBe(200);
      expect(resolve).toHaveBeenCalledOnce();
    },
  );
});
