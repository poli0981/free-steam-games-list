import { beforeEach, describe, expect, it } from "vitest";
import { filters, FILTER_PARAMS } from "./filters.svelte";

describe("the language filter in the store", () => {
  beforeEach(() => filters.reset());

  it("is a filter: active, part of the signature, cleared by reset", () => {
    const before = filters.signature;
    filters.language = "Japanese";
    // Without `active`, a language-only filter had no "Clear filters" button.
    expect(filters.active).toBe(true);
    expect(filters.signature).not.toBe(before);
    filters.reset();
    expect(filters.language).toBeNull();
    expect(filters.active).toBe(false);
  });

  it("round-trips through ?lang=", () => {
    filters.language = "Simplified Chinese";
    const q = filters.toQuery();
    expect(q.get("lang")).toBe("Simplified Chinese");
    filters.reset();
    filters.fromQuery(q);
    expect(filters.language).toBe("Simplified Chinese");
    expect(FILTER_PARAMS.has("lang")).toBe(true);
  });

  it("reads an empty ?lang= as no filter", () => {
    filters.fromQuery(new URLSearchParams("lang="));
    expect(filters.language).toBeNull();
    expect(filters.toQuery().has("lang")).toBe(false);
  });
});
