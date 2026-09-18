import { describe, expect, it } from "vitest";
import { stripSpans, withoutBlockComments } from "./source";

describe("withoutBlockComments", () => {
  it("drops HTML and block comments and keeps everything else", () => {
    expect(withoutBlockComments('<p>a</p><!-- t("x") -->b /* t("y") */c // t("z")')).toBe('<p>a</p>b c // t("z")');
  });

  it("removes each span once and never rescans its own output", () => {
    // "<!-" and "-" were never inside a comment. A replace-until-stable loop
    // joins them into "<!--" and then eats whatever follows as a comment.
    expect(stripSpans("<!-<!-- x -->- kept -->", "<!--", "-->")).toBe("<!-- kept -->");
  });

  it("leaves an opener with no closer in place", () => {
    expect(stripSpans("a /* no end", "/*", "*/")).toBe("a /* no end");
  });

  it("cuts a glob's /**/ exactly as the regexes it replaced did", () => {
    expect(stripSpans('glob("./**/*.svelte")', "/*", "*/")).toBe('glob(".*.svelte")');
  });
});
