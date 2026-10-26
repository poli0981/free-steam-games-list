import { describe, expect, it } from "vitest";
import { LEGAL_DOCS, legalDocSlug } from "#lib/legal.js";
import { params } from "./params";

/** The matcher as SvelteKit 3 runs it: a Standard Schema over the raw segment. */
async function legaldoc(slug: string) {
  return await params.legaldoc["~standard"].validate(slug);
}

describe("params.legaldoc", () => {
  it.each(LEGAL_DOCS.map((d) => legalDocSlug(d.path)))("matches the document /legal/%s", async (slug) => {
    expect(await legaldoc(slug)).toEqual({ value: slug });
  });

  it.each(["nope", "", "TOS", "tos.html", "../LICENSE"])("matches no route for /legal/%j", async (slug) => {
    expect(await legaldoc(slug)).toHaveProperty("issues");
  });
});
